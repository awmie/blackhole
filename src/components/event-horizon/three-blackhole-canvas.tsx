
"use client";

import React, { useRef, useEffect, useCallback } from 'react';
import type * as THREE_TYPE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { EffectComposer as EffectComposerType } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { RenderPass as RenderPassType } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { ShaderPass as ShaderPassType } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { UnrealBloomPass as UnrealBloomPassType } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { PlanetState, CollisionEvent } from '@/app/page';

// Gravitational Constants
const G_CONSTANT = 0.05;
const BLACK_HOLE_MASS_EQUIVALENT_FACTOR = 200;
const STAR_BASE_MASS = 150;
const PLANET_BASE_MASS = 0.5;
const MIN_GRAVITY_DISTANCE_SQ = 0.01;

export interface JetParticleState {
  id: number;
  position: THREE_TYPE.Vector3;
  velocity: THREE_TYPE.Vector3;
  life: number;
  initialLife: number;
  color: THREE_TYPE.Color;
  size: number;
  active: boolean;
}

interface EvolvingObjectData {
  id: number;
  velocity: THREE_TYPE.Vector3;
  position: THREE_TYPE.Vector3;
  ttl: number;
}

interface StarEmittedParticleState {
  id: number;
  position: THREE_TYPE.Vector3;
  velocity: THREE_TYPE.Vector3;
  life: number;
  initialLife: number;
  color: THREE_TYPE.Color;
  size: number;
  active: boolean;
}

export interface ShatterParticleState {
  id: number;
  position: THREE_TYPE.Vector3;
  velocity: THREE_TYPE.Vector3;
  life: number;
  initialLife: number;
  color: THREE_TYPE.Color;
  size: number;
  active: boolean;
}

interface ThreeBlackholeCanvasProps {
  blackHoleRadius: number;
  accretionDiskInnerRadius: number;
  accretionDiskOuterRadius: number;
  accretionDiskOpacity: number;
  onCameraUpdate: (position: { x: number; y: number; z: number }) => void;
  spawnedPlanets: PlanetState[];
  onAbsorbPlanet: (id: number) => void;
  onSetPlanetDissolving: (id: number, dissolving: boolean) => void;
  isEmittingJets: boolean;
  onCameraReady?: (camera: THREE_TYPE.PerspectiveCamera) => void;
  onShiftClickSpawnAtPoint?: (position: THREE_TYPE.Vector3) => void;
  onStarMassLoss?: (starId: number, massLossAmount: number) => void;
  onUpdatePlanetPosition?: (objectId: number, position: { x: number, y: number, z: number }, velocity: { x: number, y: number, z: number }) => void;
  collisionEvents: CollisionEvent[];
  onCollisionEventProcessed: (eventId: string) => void;
  simulationSpeed: number;
}

const NUM_DISK_PARTICLES = 50000;
const baseAngularSpeed = 1.0;
const minAngularSpeedFactor = 0.02;
const photonRingThreshold = 0.03;

const PULL_IN_FACTOR_DISSOLVING_BH = 8.0;
const DISSOLUTION_START_RADIUS_FACTOR = 1.2;
const DISSOLUTION_DURATION = 1.5;

interface DiskParticleData {
  radius: number;
  angle: number;
  angularVelocity: number;
  yOffset: number;
}

const JET_PARTICLE_COUNT = 10000;
const JET_LIFESPAN = 4.0;
const JET_SPEED = 6;
const JET_PARTICLE_BASE_SIZE = 0.003;
const JET_SPREAD_ANGLE = Math.PI / 16384;
const JET_VELOCITY_RANDOM_OFFSET_MAGNITUDE = 0.0005;
const JET_EMIT_BURST_COUNT = 150;

const STAR_EMITTED_PARTICLE_COUNT = 10000;
const STAR_DISSOLUTION_EMIT_RATE_PER_FRAME = 2;
const STAR_DISSOLUTION_PARTICLE_LIFESPAN = 1.5;
const STAR_DISSOLUTION_PARTICLE_INITIAL_SPEED = 0.3;
const STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR = 0.5;

const SHATTER_PARTICLE_POOL_SIZE = 5000;
const SHATTER_PARTICLES_PER_COLLISION = 75;
const SHATTER_PARTICLE_LIFESPAN_MIN = 0.8;
const SHATTER_PARTICLE_LIFESPAN_MAX = 1.8;
const SHATTER_PARTICLE_SPEED_MIN = 0.5;
const SHATTER_PARTICLE_SPEED_MAX = 2.5;
const SHATTER_PARTICLE_SIZE_MIN = 0.0008;
const SHATTER_PARTICLE_SIZE_MAX = 0.002;

const SHATTER_PARTICLE_GRAVITY_FACTOR_BASE = 0.02;
const SHATTER_PARTICLE_NEAR_BH_THRESHOLD_FACTOR = 4.0;
const SHATTER_PARTICLE_GRAVITY_BOOST_NEAR_BH = 25.0;
const SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH = 0.3;
const SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR = 1.1;
const SHATTER_PARTICLE_LIFESPAN_REDUCTION_NEAR_ABSORPTION = 8.0;

const NUM_BACKGROUND_STARS = 30000;

interface StarTwinkleData {
    initialSize: number;
    phase: number;
    speed: number;
}

// Lensing Shader - Enhanced for size-proportional effects
const LensingShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: null },
    bhPos: { value: null },
    bhRadius: { value: 0.0 },
    mass: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform vec2 bhPos;
    uniform float bhRadius;
    uniform float mass;
    varying vec2 vUv;
    
    void main() {
      vec2 aspectUv = vUv * vec2(resolution.x / resolution.y, 1.0);
      vec2 aspectBh = bhPos * vec2(resolution.x / resolution.y, 1.0);
      
      vec2 toBh = aspectBh - aspectUv;
      float dist = length(toBh);
      
      // Enhanced gravitational lensing effect
      // The pull is stronger for larger black holes and falls off with distance
      float lensingRange = bhRadius * 8.0; // Lensing affects area 8x the visible radius
      float normalizedDist = dist / max(bhRadius, 0.0001);
      
      // Inverse square law with smoothing
      float pullStrength = (mass / 5.0) * bhRadius * bhRadius / max(dist * dist, 0.0001);
      
      // Smooth falloff at the edge of lensing range
      float falloff = smoothstep(lensingRange, bhRadius, dist);
      float pull = pullStrength * falloff;
      
      // Add chromatic aberration effect - different colors bend differently
      vec2 normalizedDir = normalize(toBh);
      vec2 offset = normalizedDir * pull;
      offset.x /= resolution.x / resolution.y;
      
      // Sample with RGB shift for more realistic lensing
      float rgbShift = pull * 0.3;
      vec2 rOffset = offset * (1.0 + rgbShift);
      vec2 gOffset = offset;
      vec2 bOffset = offset * (1.0 - rgbShift);
      
      float r = texture2D(tDiffuse, vUv + rOffset).r;
      float g = texture2D(tDiffuse, vUv + gOffset).g;
      float b = texture2D(tDiffuse, vUv + bOffset).b;
      
      vec4 color = vec4(r, g, b, 1.0);
      
      // Black hole shows lensing on its surface - very large black center
      // The center 95% is pure black (singularity), only outer 5% shows lensing
      
      if (dist < bhRadius * 0.95) {
        // Very large singularity area - pure black (95% of radius)
        color = vec4(0.0, 0.0, 0.0, 1.0);
      } else if (dist < bhRadius) {
        // Outer 10% of event horizon - show lensing with bright inner photon ring
        float dimFactor = 0.8;
        color.rgb *= dimFactor;
        
        // Bright inner photon ring at the event horizon edge
        float innerEdgeDist = (bhRadius - dist) / (bhRadius * 0.1);
        float innerGlow = exp(-innerEdgeDist * innerEdgeDist * 15.0) * 0.7;
        color.rgb += vec3(1.0, 0.9, 0.7) * innerGlow;
      } else if (dist < bhRadius * 1.2) {
        // Outside photon ring - bright glow at event horizon edge
        float photonRingDist = (dist - bhRadius) / (bhRadius * 0.2);
        float photonRingIntensity = exp(-photonRingDist * photonRingDist * 10.0);
        vec3 photonColor = vec3(1.0, 0.95, 0.8);
        color.rgb = mix(color.rgb, photonColor, photonRingIntensity * 0.9);
      }
      
      gl_FragColor = color;
    }
  `
};

const ThreeBlackholeCanvas: React.FC<ThreeBlackholeCanvasProps> = ({
  blackHoleRadius,
  accretionDiskInnerRadius,
  accretionDiskOuterRadius,
  accretionDiskOpacity,
  onCameraUpdate,
  spawnedPlanets,
  onAbsorbPlanet,
  onSetPlanetDissolving,
  isEmittingJets,
  onCameraReady,
  onShiftClickSpawnAtPoint,
  onStarMassLoss,
  onUpdatePlanetPosition,
  collisionEvents,
  onCollisionEventProcessed,
  simulationSpeed,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE_TYPE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE_TYPE.Scene | null>(null);
  const cameraRef = useRef<THREE_TYPE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);
  const composerRef = useRef<EffectComposerType | null>(null);
  const lensingPassRef = useRef<ShaderPassType | null>(null);
  const bloomPassRef = useRef<UnrealBloomPassType | null>(null);
  
  const blackHoleRef = useRef<THREE_TYPE.Object3D | null>(null);
  const blackHoleMaterialRef = useRef<THREE_TYPE.ShaderMaterial | null>(null);
  const accretionDiskRef = useRef<THREE_TYPE.Points | null>(null);
  const starsRef = useRef<THREE_TYPE.Points | null>(null);
  const starTwinkleDataRef = useRef<StarTwinkleData[]>([]);
  
  const clockRef = useRef<THREE_TYPE.Clock | null>(null);
  const diskParticleDataRef = useRef<DiskParticleData[]>([]);
  const celestialObjectsRef = useRef<Map<number, THREE_TYPE.Object3D>>(new Map());
  const dissolvingObjectsProgressRef = useRef<Map<number, number>>(new Map());
  const evolvingObjectDataRef = useRef<Map<number, EvolvingObjectData>>(new Map());
  
  const jetParticlesRef = useRef<THREE_TYPE.Points | null>(null);
  const jetParticleDataRef = useRef<JetParticleState[]>([]);
  const jetMaterialRef = useRef<THREE_TYPE.PointsMaterial | null>(null);
  const lastJetParticleIndexRef = useRef(0);
  
  const starEmittedParticlesRef = useRef<THREE_TYPE.Points | null>(null);
  const starEmittedParticleDataRef = useRef<StarEmittedParticleState[]>([]);
  const starEmittedParticleMaterialRef = useRef<THREE_TYPE.PointsMaterial | null>(null);
  const lastStarEmittedParticleIndexRef = useRef(0);
  
  const shatterParticlesRef = useRef<THREE_TYPE.Points | null>(null);
  const shatterParticleDataRef = useRef<ShatterParticleState[]>([]);
  const shatterParticleMaterialRef = useRef<THREE_TYPE.PointsMaterial | null>(null);
  const lastShatterParticleIndexRef = useRef(0);
  
  const tempVectorRef = useRef<THREE_TYPE.Vector3 | null>(null);
  const tempVector2Ref = useRef<THREE_TYPE.Vector3 | null>(null);
  const tempQuaternionRef = useRef<THREE_TYPE.Quaternion | null>(null);
  
  const THREEInstanceRef = useRef<typeof THREE_TYPE | null>(null);
  
  const onShiftClickSpawnAtPointRef = useRef(onShiftClickSpawnAtPoint);
  const onCameraUpdateRef = useRef(onCameraUpdate);
  const onAbsorbPlanetRef = useRef(onAbsorbPlanet);
  const onSetPlanetDissolvingRef = useRef(onSetPlanetDissolving);
  const onStarMassLossRef = useRef(onStarMassLoss);
  const onUpdatePlanetPositionRef = useRef(onUpdatePlanetPosition);
  const collisionEventsRef = useRef(collisionEvents);
  const onCollisionEventProcessedRef = useRef(onCollisionEventProcessed);
  
  const spawnedObjectsRef_anim = useRef(spawnedPlanets);
  useEffect(() => { spawnedObjectsRef_anim.current = spawnedPlanets; }, [spawnedPlanets]);
  
  const isEmittingJetsRef_anim = useRef(isEmittingJets);
  useEffect(() => { isEmittingJetsRef_anim.current = isEmittingJets; }, [isEmittingJets]);
  
  const blackHoleRadiusRef_anim = useRef(blackHoleRadius);
  useEffect(() => { blackHoleRadiusRef_anim.current = blackHoleRadius; }, [blackHoleRadius]);
  
  const simulationSpeedRef_anim = useRef(simulationSpeed);
  useEffect(() => { simulationSpeedRef_anim.current = simulationSpeed; }, [simulationSpeed]);
  
  useEffect(() => { onShiftClickSpawnAtPointRef.current = onShiftClickSpawnAtPoint; }, [onShiftClickSpawnAtPoint]);
  useEffect(() => { onCameraUpdateRef.current = onCameraUpdate; }, [onCameraUpdate]);
  useEffect(() => { onAbsorbPlanetRef.current = onAbsorbPlanet; }, [onAbsorbPlanet]);
  useEffect(() => { onSetPlanetDissolvingRef.current = onSetPlanetDissolving; }, [onSetPlanetDissolving]);
  useEffect(() => { onStarMassLossRef.current = onStarMassLoss; }, [onStarMassLoss]);
  useEffect(() => { onUpdatePlanetPositionRef.current = onUpdatePlanetPosition; }, [onUpdatePlanetPosition]);
  useEffect(() => { collisionEventsRef.current = collisionEvents; }, [collisionEvents]);
  useEffect(() => { onCollisionEventProcessedRef.current = onCollisionEventProcessed; }, [onCollisionEventProcessed]);

  const createAndAddAccretionParticles = useCallback((
    innerR: number,
    outerR: number,
    opacity: number
  ) => {
    const THREE = THREEInstanceRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (accretionDiskRef.current) {
      scene.remove(accretionDiskRef.current);
      accretionDiskRef.current.geometry.dispose();
      (accretionDiskRef.current.material as THREE_TYPE.Material).dispose();
      accretionDiskRef.current = null;
    }

    const particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_DISK_PARTICLES * 3);
    const colors = new Float32Array(NUM_DISK_PARTICLES * 4);
    diskParticleDataRef.current = [];

    const colorInner = new THREE.Color(1.0, 0.4, 0.8);
    const colorMid = new THREE.Color(0.6, 0.3, 0.9);
    const colorOuter = new THREE.Color(0.2, 0.1, 0.7);
    const colorPhotonRing = new THREE.Color(1.0, 0.95, 0.85);
    const outerFadeStartNormalized = 0.7;

    for (let i = 0; i < NUM_DISK_PARTICLES; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      const radius = Math.random() * (outerR - innerR) + innerR;
      const angle = Math.random() * Math.PI * 2;
      const yOffset = (Math.random() - 0.5) * 0.1;

      let normalizedDist = (radius - innerR) / (outerR - innerR);
      normalizedDist = Math.max(0, Math.min(1, normalizedDist));

      let angularVelocity = baseAngularSpeed * Math.pow(innerR / radius, 2.5);
      angularVelocity = Math.max(angularVelocity, baseAngularSpeed * minAngularSpeedFactor);

      diskParticleDataRef.current.push({ radius, angle, angularVelocity, yOffset });

      positions[i3] = radius * Math.cos(angle);
      positions[i3 + 1] = yOffset;
      positions[i3 + 2] = radius * Math.sin(angle);

      const particleColor = new THREE.Color();
      if (normalizedDist < 0.5) {
        particleColor.lerpColors(colorInner, colorMid, normalizedDist * 2.0);
      } else {
        particleColor.lerpColors(colorMid, colorOuter, (normalizedDist - 0.5) * 2.0);
      }

      if (normalizedDist < photonRingThreshold) {
        let photonRingIntensity = (photonRingThreshold - normalizedDist) / photonRingThreshold;
        photonRingIntensity = Math.pow(photonRingIntensity, 1.5);
        particleColor.lerp(colorPhotonRing, photonRingIntensity);
        particleColor.r = Math.min(1.0, particleColor.r + photonRingIntensity * 2.5);
        particleColor.g = Math.min(1.0, particleColor.g + photonRingIntensity * 2.5);
        particleColor.b = Math.min(1.0, particleColor.b + photonRingIntensity * 2.5);
      }

      colors[i4] = particleColor.r;
      colors[i4 + 1] = particleColor.g;
      colors[i4 + 2] = particleColor.b;

      let particleAlpha = opacity;
      if (normalizedDist > outerFadeStartNormalized) {
        particleAlpha *= (1.0 - (normalizedDist - outerFadeStartNormalized) / (1.0 - outerFadeStartNormalized));
      }
      colors[i4 + 3] = Math.max(0.0, Math.min(1.0, particleAlpha));
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.01,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const newDisk = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(newDisk);
    accretionDiskRef.current = newDisk;
  }, []);

  const initJetParticles = useCallback(() => {
    const THREE = THREEInstanceRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (jetParticlesRef.current) {
      scene.remove(jetParticlesRef.current);
      jetParticlesRef.current.geometry.dispose();
      if (jetParticlesRef.current.material instanceof THREE.Material) {
        (jetParticlesRef.current.material as THREE_TYPE.Material).dispose();
      }
      jetParticlesRef.current = null;
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(JET_PARTICLE_COUNT * 3);
    const colorsAttribute = new Float32Array(JET_PARTICLE_COUNT * 3);
    const sizesAttribute = new Float32Array(JET_PARTICLE_COUNT);

    jetParticleDataRef.current = [];
    for (let i = 0; i < JET_PARTICLE_COUNT; i++) {
      jetParticleDataRef.current.push({
        id: i,
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        initialLife: JET_LIFESPAN,
        color: new THREE.Color(1, 1, 1),
        size: JET_PARTICLE_BASE_SIZE,
        active: false,
      });
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000;
      positions[i * 3 + 2] = 0;
      colorsAttribute[i * 3] = 1;
      colorsAttribute[i * 3 + 1] = 1;
      colorsAttribute[i * 3 + 2] = 1;
      sizesAttribute[i] = JET_PARTICLE_BASE_SIZE;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));

    jetMaterialRef.current = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    jetParticlesRef.current = new THREE.Points(geometry, jetMaterialRef.current);
    jetParticlesRef.current.frustumCulled = false;
    scene.add(jetParticlesRef.current);
    lastJetParticleIndexRef.current = 0;
  }, []);

  const initStarEmittedParticles = useCallback(() => {
    const THREE = THREEInstanceRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (starEmittedParticlesRef.current) {
      scene.remove(starEmittedParticlesRef.current);
      starEmittedParticlesRef.current.geometry.dispose();
      if (starEmittedParticlesRef.current.material instanceof THREE.Material) {
        (starEmittedParticlesRef.current.material as THREE_TYPE.Material).dispose();
      }
      starEmittedParticlesRef.current = null;
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_EMITTED_PARTICLE_COUNT * 3);
    const colorsAttribute = new Float32Array(STAR_EMITTED_PARTICLE_COUNT * 3);
    const sizesAttribute = new Float32Array(STAR_EMITTED_PARTICLE_COUNT);

    starEmittedParticleDataRef.current = [];
    for (let i = 0; i < STAR_EMITTED_PARTICLE_COUNT; i++) {
      starEmittedParticleDataRef.current.push({
        id: i,
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        initialLife: STAR_DISSOLUTION_PARTICLE_LIFESPAN,
        color: new THREE.Color(1, 1, 1),
        size: 0.0005,
        active: false,
      });
      const i3 = i * 3;
      positions[i3] = 0;
      positions[i3 + 1] = -1000;
      positions[i3 + 2] = 0;
      colorsAttribute[i3] = 1;
      colorsAttribute[i3 + 1] = 1;
      colorsAttribute[i3 + 2] = 1;
      sizesAttribute[i] = 0.0005;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));

    starEmittedParticleMaterialRef.current = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    starEmittedParticlesRef.current = new THREE.Points(geometry, starEmittedParticleMaterialRef.current);
    starEmittedParticlesRef.current.frustumCulled = false;
    scene.add(starEmittedParticlesRef.current);
    lastStarEmittedParticleIndexRef.current = 0;
  }, []);

  const initShatterParticles = useCallback(() => {
    const THREE = THREEInstanceRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (shatterParticlesRef.current) {
      scene.remove(shatterParticlesRef.current);
      shatterParticlesRef.current.geometry.dispose();
      if (shatterParticlesRef.current.material instanceof THREE.Material) {
        (shatterParticlesRef.current.material as THREE_TYPE.Material).dispose();
      }
      shatterParticlesRef.current = null;
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SHATTER_PARTICLE_POOL_SIZE * 3);
    const colorsAttribute = new Float32Array(SHATTER_PARTICLE_POOL_SIZE * 3);
    const sizesAttribute = new Float32Array(SHATTER_PARTICLE_POOL_SIZE);

    shatterParticleDataRef.current = [];
    for (let i = 0; i < SHATTER_PARTICLE_POOL_SIZE; i++) {
      shatterParticleDataRef.current.push({
        id: i,
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        initialLife: 1,
        color: new THREE.Color(1, 1, 1),
        size: 0.01,
        active: false,
      });
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000;
      positions[i * 3 + 2] = 0;
      colorsAttribute[i * 3] = 1;
      colorsAttribute[i * 3 + 1] = 1;
      colorsAttribute[i * 3 + 2] = 1;
      sizesAttribute[i] = 0.01;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));

    shatterParticleMaterialRef.current = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    shatterParticlesRef.current = new THREE.Points(geometry, shatterParticleMaterialRef.current);
    shatterParticlesRef.current.frustumCulled = false;
    scene.add(shatterParticlesRef.current);
    lastShatterParticleIndexRef.current = 0;
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !THREEInstanceRef.current) return;

    initJetParticles();
    initStarEmittedParticles();
    initShatterParticles();
  }, [initJetParticles, initStarEmittedParticles, initShatterParticles]);

  useEffect(() => {
    if (!mountRef.current) return;

    const LocalTHREE = require('three') as typeof THREE_TYPE;
    THREEInstanceRef.current = LocalTHREE;
    const THREE = THREEInstanceRef.current;
    if (!THREE) return;

    tempVectorRef.current = new THREE.Vector3();
    tempVector2Ref.current = new THREE.Vector3();
    tempQuaternionRef.current = new THREE.Quaternion();

    const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls.js') as { OrbitControls: typeof OrbitControlsType };
    const { EffectComposer } = require('three/examples/jsm/postprocessing/EffectComposer.js') as { EffectComposer: typeof EffectComposerType };
    const { RenderPass } = require('three/examples/jsm/postprocessing/RenderPass.js') as { RenderPass: typeof RenderPassType };
    const { ShaderPass } = require('three/examples/jsm/postprocessing/ShaderPass.js') as { ShaderPass: typeof ShaderPassType };
    const { UnrealBloomPass } = require('three/examples/jsm/postprocessing/UnrealBloomPass.js') as { UnrealBloomPass: typeof UnrealBloomPassType };

    if (!clockRef.current) {
      clockRef.current = new THREE.Clock();
    }

    sceneRef.current = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, blackHoleRadiusRef_anim.current * 1.5, blackHoleRadiusRef_anim.current * 4);
    cameraRef.current = camera;
    if (onCameraReady) { onCameraReady(camera); }
    if (onCameraUpdateRef.current) { onCameraUpdateRef.current({ x: camera.position.x, y: camera.position.y, z: camera.position.z }); }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Setup post-processing
    const composer = new EffectComposer(renderer);
    
    // Render pass
    const renderPass = new RenderPass(sceneRef.current, camera);
    composer.addPass(renderPass);
    
    // Lensing pass
    const lensingPass = new ShaderPass(LensingShader);
    lensingPass.uniforms.resolution.value = new THREE.Vector2(
      mountRef.current.clientWidth * window.devicePixelRatio,
      mountRef.current.clientHeight * window.devicePixelRatio
    );
    lensingPass.uniforms.bhPos.value = new THREE.Vector2(0.5, 0.5);
    composer.addPass(lensingPass);
    lensingPassRef.current = lensingPass;
    
    // Bloom pass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(mountRef.current.clientWidth, mountRef.current.clientHeight),
      1.5, 0.4, 0.85
    );
    composer.addPass(bloomPass);
    bloomPassRef.current = bloomPass;
    
    composerRef.current = composer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = blackHoleRadiusRef_anim.current * 1.2;
    controls.maxDistance = 80;
    controlsRef.current = controls;

    controls.addEventListener('change', () => {
      if (cameraRef.current && onCameraUpdateRef.current) {
        onCameraUpdateRef.current({ x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z });
      }
    });

    // Black hole is rendered entirely by lensing shader - no solid mesh
    // Only a reference object for positioning
    const blackHoleMesh = new THREE.Object3D();
    blackHoleMesh.position.set(0, 0, 0);
    sceneRef.current.add(blackHoleMesh);
    blackHoleRef.current = blackHoleMesh;

    createAndAddAccretionParticles(accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);

    // Background stars
    const starsGeometry = new THREE.BufferGeometry();
    const starVertices: number[] = [];
    const starInitialSizes: number[] = [];
    starTwinkleDataRef.current = [];

    for (let i = 0; i < NUM_BACKGROUND_STARS; i++) {
      const r = 200 + Math.random() * 600;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      starVertices.push(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta)
      );

      const initialSize = 0.7 + Math.random() * 0.4;
      starInitialSizes.push(initialSize);
      starTwinkleDataRef.current.push({
        initialSize: initialSize,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
      });
    }
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starInitialSizes, 1));

    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, sizeAttenuation: true });
    starsRef.current = new THREE.Points(starsGeometry, starsMaterial);
    sceneRef.current.add(starsRef.current);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    sceneRef.current.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    sceneRef.current.add(directionalLight);

    if (!jetParticlesRef.current) initJetParticles();
    if (!starEmittedParticlesRef.current) initStarEmittedParticles();
    if (!shatterParticlesRef.current) initShatterParticles();

    const currentRendererDomElement = renderer.domElement;
    const handleCanvasShiftClick = (event: PointerEvent) => {
      const THREE_INSTANCE = THREEInstanceRef.current;
      if (!event.shiftKey || !cameraRef.current || !onShiftClickSpawnAtPointRef.current || !THREE_INSTANCE) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = currentRendererDomElement.getBoundingClientRect();
      const mouse = new THREE_INSTANCE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE_INSTANCE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);
      const plane = new THREE_INSTANCE.Plane(new THREE_INSTANCE.Vector3(0, 1, 0), 0);
      const intersectionPoint = new THREE_INSTANCE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
        onShiftClickSpawnAtPointRef.current(intersectionPoint);
      }
    };
    currentRendererDomElement.addEventListener('pointerdown', handleCanvasShiftClick);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const THREE_ANIM = THREEInstanceRef.current;
      const composer_anim = composerRef.current;
      const scene_anim = sceneRef.current;
      const mainCam_anim = cameraRef.current;
      const lensingPass_anim = lensingPassRef.current;
      const bh_anim = blackHoleRef.current;
      const renderer_anim = rendererRef.current;
      const _tempVec = tempVectorRef.current;
      const _tempVec2 = tempVectorRef.current;
      const _tempQuat = tempQuaternionRef.current;

      if (!clockRef.current || !THREE_ANIM || !composer_anim || !scene_anim || !mainCam_anim || !lensingPass_anim || !bh_anim || !renderer_anim || !_tempVec || !_tempVec2 || !_tempQuat) return;

      const deltaTime = clockRef.current.getDelta();
      const elapsedTime = clockRef.current.getElapsedTime();
      const effectiveDeltaTime = deltaTime * simulationSpeedRef_anim.current;

      controlsRef.current?.update();

      // Accretion disk animation
      if (accretionDiskRef.current?.geometry) {
        const positions = accretionDiskRef.current.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < diskParticleDataRef.current.length; i++) {
          const pData = diskParticleDataRef.current[i];
          pData.angle += pData.angularVelocity * effectiveDeltaTime;
          const i3 = i * 3;
          positions[i3] = pData.radius * Math.cos(pData.angle);
          positions[i3 + 2] = pData.radius * Math.sin(pData.angle);
        }
        accretionDiskRef.current.geometry.attributes.position.needsUpdate = true;
      }

      // Background stars twinkling
      if (starsRef.current?.geometry) {
        const sizes = starsRef.current.geometry.attributes.size as THREE_TYPE.BufferAttribute;
        const twinkleData = starTwinkleDataRef.current;
        if (sizes && twinkleData.length === NUM_BACKGROUND_STARS) {
          for (let i = 0; i < NUM_BACKGROUND_STARS; i++) {
            const data = twinkleData[i];
            const scale = 0.6 + Math.sin(elapsedTime * data.speed + data.phase) * 0.4;
            (sizes.array as Float32Array)[i] = data.initialSize * Math.max(0.1, scale);
          }
          sizes.needsUpdate = true;
        }
      }

      // N-body physics for spawned objects
      spawnedObjectsRef_anim.current.forEach(objProp => {
        const object3D = celestialObjectsRef.current.get(objProp.id);
        let evolvingData = evolvingObjectDataRef.current.get(objProp.id);

        if (!object3D || !evolvingData) return;

        evolvingData.ttl -= deltaTime;

        const blackHoleActualRadius = blackHoleRadiusRef_anim.current;
        const currentStarMassFactor = (objProp.type === 'star' ? objProp.currentMassFactor : 1.0) ?? 1.0;

        if (objProp.isDissolving) {
          let progress = dissolvingObjectsProgressRef.current.get(objProp.id) || 0;
          progress += deltaTime / (objProp.timeToLive > 0 ? objProp.timeToLive : DISSOLUTION_DURATION);
          progress = Math.min(progress, 1);
          dissolvingObjectsProgressRef.current.set(objProp.id, progress);

          const scaleFactor = 1 - progress;
          object3D.scale.set(
            objProp.initialScale.x * currentStarMassFactor * scaleFactor,
            objProp.initialScale.y * currentStarMassFactor * scaleFactor,
            objProp.initialScale.z * currentStarMassFactor * scaleFactor
          );

          _tempVec.copy(bh_anim.position).sub(evolvingData.position).normalize();
          evolvingData.velocity.addScaledVector(_tempVec, PULL_IN_FACTOR_DISSOLVING_BH * blackHoleActualRadius * effectiveDeltaTime * (0.5 + progress * 1.5));
          evolvingData.position.addScaledVector(evolvingData.velocity, effectiveDeltaTime);

          if (objProp.type === 'star' && starEmittedParticlesRef.current && starEmittedParticleDataRef.current.length > 0 && object3D) {
            const starColor = new THREE_ANIM.Color(objProp.color);
            for (let i = 0; i < STAR_DISSOLUTION_EMIT_RATE_PER_FRAME; i++) {
              const pIndex = lastStarEmittedParticleIndexRef.current;
              const particle = starEmittedParticleDataRef.current[pIndex];
              if (particle && !particle.active) {
                particle.active = true;
                particle.position.copy(object3D.position);
                const randomDirection = new THREE_ANIM.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                particle.velocity.copy(randomDirection).multiplyScalar(STAR_DISSOLUTION_PARTICLE_INITIAL_SPEED);
                particle.life = 1.0;
                particle.initialLife = STAR_DISSOLUTION_PARTICLE_LIFESPAN + Math.random() * 0.1;
                particle.color.copy(starColor);
                particle.size = (0.0005 + Math.random() * 0.0005) * Math.min(1.0, currentStarMassFactor * 0.5 + 0.5);
              }
              lastStarEmittedParticleIndexRef.current = (pIndex + 1) % STAR_EMITTED_PARTICLE_COUNT;
            }
          }

          if (progress >= 1 || evolvingData.position.lengthSq() < blackHoleActualRadius * blackHoleActualRadius * 0.01) {
            if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(objProp.id);
            evolvingObjectDataRef.current.delete(objProp.id);
            dissolvingObjectsProgressRef.current.delete(objProp.id);
          }
        } else {
          const acceleration = _tempVec2.set(0, 0, 0);
          const currentMass = objProp.type === 'star'
            ? STAR_BASE_MASS * currentStarMassFactor
            : PLANET_BASE_MASS * (objProp.initialScale.x / 0.1);

          const blackHoleEffectiveMass = BLACK_HOLE_MASS_EQUIVALENT_FACTOR * blackHoleActualRadius;
          _tempVec.copy(bh_anim.position).sub(evolvingData.position);
          let distSqToBH = _tempVec.lengthSq();
          distSqToBH = Math.max(distSqToBH, MIN_GRAVITY_DISTANCE_SQ + blackHoleActualRadius * blackHoleActualRadius);
          const forceMagBH = (G_CONSTANT * blackHoleEffectiveMass * currentMass) / distSqToBH;
          acceleration.addScaledVector(_tempVec.normalize(), forceMagBH / currentMass);

          spawnedObjectsRef_anim.current.forEach(otherObjProp => {
            if (otherObjProp.id !== objProp.id && otherObjProp.type === 'star' && !otherObjProp.isDissolving) {
              const otherObject3D = celestialObjectsRef.current.get(otherObjProp.id);
              const otherEvolvingData = evolvingObjectDataRef.current.get(otherObjProp.id);
              if (otherObject3D && otherEvolvingData) {
                const otherStarMass = STAR_BASE_MASS * (otherObjProp.currentMassFactor || 1.0);
                _tempVec.copy(otherEvolvingData.position).sub(evolvingData.position);
                let distSqToOther = _tempVec.lengthSq();
                distSqToOther = Math.max(distSqToOther, MIN_GRAVITY_DISTANCE_SQ);
                const forceMagOther = (G_CONSTANT * otherStarMass * currentMass) / distSqToOther;
                acceleration.addScaledVector(_tempVec.normalize(), forceMagOther / currentMass);
              }
            }
          });

          evolvingData.velocity.addScaledVector(acceleration, effectiveDeltaTime);
          evolvingData.position.addScaledVector(evolvingData.velocity, effectiveDeltaTime);

          if (evolvingData.position.lengthSq() < (blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR * blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR) && onSetPlanetDissolvingRef.current) {
            onSetPlanetDissolvingRef.current(objProp.id, true);
          } else if (evolvingData.ttl <= 0 || evolvingData.position.lengthSq() < blackHoleActualRadius * blackHoleActualRadius * 0.01) {
            if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(objProp.id);
            evolvingObjectDataRef.current.delete(objProp.id);
            dissolvingObjectsProgressRef.current.delete(objProp.id);
          }
        }
        object3D.position.copy(evolvingData.position);
        object3D.scale.set(
          objProp.initialScale.x * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1),
          objProp.initialScale.y * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1),
          objProp.initialScale.z * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1)
        );

        if (evolvingData.velocity.lengthSq() > 0.001 && !objProp.isDissolving) {
          _tempVec.copy(evolvingData.position).add(evolvingData.velocity);
          object3D.lookAt(_tempVec);
        }

        if (onUpdatePlanetPositionRef.current) {
          onUpdatePlanetPositionRef.current(objProp.id,
            { x: evolvingData.position.x, y: evolvingData.position.y, z: evolvingData.position.z },
            { x: evolvingData.velocity.x, y: evolvingData.velocity.y, z: evolvingData.velocity.z }
          );
        }
      });

      // Star emitted particles update
      if (starEmittedParticlesRef.current?.geometry && starEmittedParticleMaterialRef.current && starEmittedParticleDataRef.current.length > 0 && THREE_ANIM) {
        const positions = starEmittedParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = starEmittedParticlesRef.current.geometry.attributes.color.array as Float32Array;
        const sizes = starEmittedParticlesRef.current.geometry.attributes.size.array as Float32Array;
        let hasActiveStarParticles = false;

        starEmittedParticleDataRef.current.forEach((p, i) => {
          if (p.active && p.life > 0) {
            hasActiveStarParticles = true;
            _tempVec.copy(bh_anim.position).sub(p.position);
            const distanceSq = Math.max(0.1, p.position.lengthSq());
            const gravityFactor = STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR;
            _tempVec.normalize().multiplyScalar(gravityFactor / distanceSq);
            p.velocity.addScaledVector(_tempVec, effectiveDeltaTime);
            p.position.addScaledVector(p.velocity, effectiveDeltaTime);

            p.life -= deltaTime / p.initialLife;
            const i3 = i * 3;
            positions[i3] = p.position.x;
            positions[i3 + 1] = p.position.y;
            positions[i3 + 2] = p.position.z;
            const fade = Math.max(0, p.life);
            colors[i3] = p.color.r * fade;
            colors[i3 + 1] = p.color.g * fade;
            colors[i3 + 2] = p.color.b * fade;
            sizes[i] = p.size * fade;
            if (p.life <= 0 || p.position.lengthSq() < (blackHoleRadiusRef_anim.current * blackHoleRadiusRef_anim.current * 0.01)) {
              p.active = false;
              positions[i3 + 1] = -1000;
            }
          } else if (p.active === false && positions[i * 3 + 1] > -999) {
            positions[i * 3 + 1] = -1000;
            hasActiveStarParticles = true;
          }
        });
        if (hasActiveStarParticles) {
          starEmittedParticlesRef.current.geometry.attributes.position.needsUpdate = true;
          starEmittedParticlesRef.current.geometry.attributes.color.needsUpdate = true;
          starEmittedParticlesRef.current.geometry.attributes.size.needsUpdate = true;
        }
      }

      // Jet particles update
      if (jetParticlesRef.current?.geometry && jetMaterialRef.current && jetParticleDataRef.current.length > 0 && THREE_ANIM) {
        const positions = jetParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const colorsAttribute = jetParticlesRef.current.geometry.attributes.color.array as Float32Array;
        const sizesAttribute = jetParticlesRef.current.geometry.attributes.size.array as Float32Array;
        let activeJetsVisualsNeedUpdate = false;

        if (isEmittingJetsRef_anim.current) {
          activeJetsVisualsNeedUpdate = true;
          for (let jetDirection of [1, -1]) {
            for (let i = 0; i < JET_EMIT_BURST_COUNT; i++) {
              const pIndex = lastJetParticleIndexRef.current;
              const jetP = jetParticleDataRef.current[pIndex];
              if (jetP && !jetP.active) {
                jetP.active = true;
                jetP.position.set(0, jetDirection * blackHoleRadiusRef_anim.current * 1.05, 0);

                const coneAngle = Math.random() * Math.PI * 2;
                const elevationAngle = (Math.random() * JET_SPREAD_ANGLE) - (JET_SPREAD_ANGLE / 2);
                let velDir = new THREE_ANIM.Vector3(
                  Math.sin(elevationAngle) * Math.cos(coneAngle),
                  Math.cos(elevationAngle) * jetDirection,
                  Math.sin(elevationAngle) * Math.sin(coneAngle)
                );
                const randomOffset = new THREE_ANIM.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
                  .normalize().multiplyScalar(JET_VELOCITY_RANDOM_OFFSET_MAGNITUDE);
                velDir.add(randomOffset).normalize();

                jetP.velocity.copy(velDir).multiplyScalar(JET_SPEED * (0.7 + Math.random() * 0.6));
                jetP.life = 1.0;
              }
              lastJetParticleIndexRef.current = (pIndex + 1) % JET_PARTICLE_COUNT;
            }
          }
        }

        jetParticleDataRef.current.forEach((p, i) => {
          if (p.active) {
            activeJetsVisualsNeedUpdate = true;
            p.life -= deltaTime / p.initialLife;

            if (p.life <= 0) {
              p.active = false;
              p.position.y = -1000;
            } else {
              p.position.addScaledVector(p.velocity, effectiveDeltaTime);

              const fade = Math.max(0, p.life);
              const i3 = i * 3;
              positions[i3] = p.position.x;
              positions[i3 + 1] = p.position.y;
              positions[i3 + 2] = p.position.z;

              const jetColorProgression = Math.max(0, 1 - (JET_LIFESPAN - p.life * JET_LIFESPAN));
              colorsAttribute[i3] = p.color.r * fade;
              colorsAttribute[i3 + 1] = p.color.g * fade * (1 - jetColorProgression * 0.5);
              colorsAttribute[i3 + 2] = p.color.b * fade * (1 - jetColorProgression * 0.8);
              sizesAttribute[i] = p.size * fade;
            }
          }
        });

        if (activeJetsVisualsNeedUpdate) {
          jetParticlesRef.current.geometry.attributes.position.needsUpdate = true;
          jetParticlesRef.current.geometry.attributes.color.needsUpdate = true;
          jetParticlesRef.current.geometry.attributes.size.needsUpdate = true;
        }
      }

      // Shatter particles update
      if (shatterParticlesRef.current?.geometry && shatterParticleMaterialRef.current && shatterParticleDataRef.current.length > 0 && collisionEventsRef.current.length > 0 && THREE_ANIM) {
        const newEvents = collisionEventsRef.current.filter(e => !recentlyCollidedPairs.current?.has(e.id));
        if (newEvents.length > 0) {
          newEvents.forEach(event => {
            const collisionPoint = new THREE_ANIM.Vector3(event.point.x, event.point.y, event.point.z);
            const color1 = new THREE_ANIM.Color(event.color1);
            const color2 = new THREE_ANIM.Color(event.color2);

            for (let i = 0; i < SHATTER_PARTICLES_PER_COLLISION; i++) {
              const pIndex = lastShatterParticleIndexRef.current;
              const particle = shatterParticleDataRef.current[pIndex];
              if (particle && !particle.active) {
                particle.active = true;
                particle.position.copy(collisionPoint);

                const randomDir = new THREE_ANIM.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                const speed = SHATTER_PARTICLE_SPEED_MIN + Math.random() * (SHATTER_PARTICLE_SPEED_MAX - SHATTER_PARTICLE_SPEED_MIN);
                particle.velocity.copy(randomDir).multiplyScalar(speed);

                particle.life = 1.0;
                particle.initialLife = SHATTER_PARTICLE_LIFESPAN_MIN + Math.random() * (SHATTER_PARTICLE_LIFESPAN_MAX - SHATTER_PARTICLE_LIFESPAN_MIN);

                const mixRatio = Math.random();
                particle.color.copy(color1).lerp(color2, mixRatio);

                particle.size = SHATTER_PARTICLE_SIZE_MIN + Math.random() * (SHATTER_PARTICLE_SIZE_MAX - SHATTER_PARTICLE_SIZE_MIN);
              }
              lastShatterParticleIndexRef.current = (pIndex + 1) % SHATTER_PARTICLE_POOL_SIZE;
            }

            if (onCollisionEventProcessedRef.current) {
              onCollisionEventProcessedRef.current(event.id);
            }
          });
        }

        const positions = shatterParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = shatterParticlesRef.current.geometry.attributes.color.array as Float32Array;
        const sizes = shatterParticlesRef.current.geometry.attributes.size.array as Float32Array;
        let hasActiveShatterParticles = false;

        shatterParticleDataRef.current.forEach((p, i) => {
          if (p.active && p.life > 0) {
            hasActiveShatterParticles = true;

            const distanceToBHSq = p.position.lengthSq();
            const blackHoleActualRadius = blackHoleRadiusRef_anim.current;
            const thresholdRadius = blackHoleActualRadius * SHATTER_PARTICLE_NEAR_BH_THRESHOLD_FACTOR;
            const isVeryCloseToBH = distanceToBHSq < thresholdRadius * thresholdRadius;
            const isWithinQuickAbsorption = distanceToBHSq < (blackHoleActualRadius * blackHoleActualRadius * SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR * SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR);

            let effectiveGravityFactor = SHATTER_PARTICLE_GRAVITY_FACTOR_BASE * blackHoleActualRadius;

            if (isVeryCloseToBH) {
              effectiveGravityFactor *= SHATTER_PARTICLE_GRAVITY_BOOST_NEAR_BH;
              const closenessFactor = 1.0 - Math.sqrt(distanceToBHSq) / thresholdRadius;

              if (!isWithinQuickAbsorption) {
                const tangentDirection = new THREE_ANIM.Vector3(-p.position.z, 0, p.position.x).normalize();
                const spiralMagnitude = SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH * closenessFactor * effectiveGravityFactor * effectiveDeltaTime * 0.1;
                p.velocity.addScaledVector(tangentDirection, spiralMagnitude);
              }
            }

            const forceDirection = tempVectorRef.current!.copy(p.position).negate();
            const invDistanceSq = 1.0 / Math.max(0.01, distanceToBHSq);
            forceDirection.normalize().multiplyScalar(effectiveGravityFactor * blackHoleActualRadius * invDistanceSq);

            p.velocity.addScaledVector(forceDirection, effectiveDeltaTime);
            p.position.addScaledVector(p.velocity, effectiveDeltaTime);

            let lifeReductionFactor = 1.0;
            if (isVeryCloseToBH) {
              lifeReductionFactor = SHATTER_PARTICLE_LIFESPAN_REDUCTION_NEAR_ABSORPTION;
            }
            p.life -= (deltaTime / p.initialLife) * lifeReductionFactor;

            const i3 = i * 3;
            positions[i3] = p.position.x;
            positions[i3 + 1] = p.position.y;
            positions[i3 + 2] = p.position.z;
            const fade = Math.max(0, p.life);
            colors[i3] = p.color.r * fade;
            colors[i3 + 1] = p.color.g * fade;
            colors[i3 + 2] = p.color.b * fade;
            sizes[i] = p.size * fade;

            if (p.life <= 0 || distanceToBHSq < (blackHoleActualRadius * blackHoleActualRadius * 0.9)) {
              p.active = false;
              positions[i3 + 1] = -1000;
            }
          } else if (!p.active && positions[i * 3 + 1] > -999) {
            positions[i * 3 + 1] = -1000;
            hasActiveShatterParticles = true;
          }
        });

        if (hasActiveShatterParticles) {
          shatterParticlesRef.current.geometry.attributes.position.needsUpdate = true;
          shatterParticlesRef.current.geometry.attributes.color.needsUpdate = true;
          shatterParticlesRef.current.geometry.attributes.size.needsUpdate = true;
        }
      }

      // Update lensing shader RIGHT BEFORE rendering for maximum accuracy
      bh_anim.updateMatrixWorld();
      
      const screenPosition = new THREE_ANIM.Vector3(0, 0, 0);
      screenPosition.project(mainCam_anim);
      lensingPass_anim.uniforms.bhPos.value.set(
        (screenPosition.x + 1) / 2,
        (screenPosition.y + 1) / 2
      );
      
      // Calculate consistent screen-space radius based on camera distance
      // This ensures the black hole size doesn't change when rotating
      const actualRadius = blackHoleRadiusRef_anim.current;
      const distanceToCamera = mainCam_anim.position.distanceTo(bh_anim.position);
      const vFOV = (mainCam_anim.fov * Math.PI) / 180;
      const heightAtDistance = 2 * Math.tan(vFOV / 2) * distanceToCamera;
      const screenHeight = renderer_anim.domElement.height;
      const pixelRadius = (actualRadius / heightAtDistance) * screenHeight;
      const screenRadius = pixelRadius / screenHeight; // Convert to 0-1 range
      
      lensingPass_anim.uniforms.bhRadius.value = Math.max(screenRadius, 0.001);
      // Mass ∝ radius³ for volume-based realistic lensing
      lensingPass_anim.uniforms.mass.value = Math.pow(actualRadius, 3) * 50;

      // Render via composer
      composer_anim.render();
    };
    animate();

    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current && composerRef.current && lensingPassRef.current) {
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
        composerRef.current.setSize(width, height);
        lensingPassRef.current.uniforms.resolution.value.set(width * window.devicePixelRatio, height * window.devicePixelRatio);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (currentRendererDomElement) {
        currentRendererDomElement.removeEventListener('pointerdown', handleCanvasShiftClick);
      }
      if (controlsRef.current) { controlsRef.current.dispose(); }
      cancelAnimationFrame(animationFrameId);

      celestialObjectsRef.current.forEach(object => {
        sceneRef.current?.remove(object);
        if ('traverse' in object) {
          (object as THREE_TYPE.Object3D).traverse(child => {
            if ((child as THREE_TYPE.Mesh).geometry) {
              (child as THREE_TYPE.Mesh).geometry?.dispose();
            }
            const material = (child as THREE_TYPE.Mesh).material;
            if (material) {
              if (Array.isArray(material)) {
                material.forEach(m => m.dispose());
              } else {
                material.dispose();
              }
            }
          });
        }
      });
      celestialObjectsRef.current.clear();
      dissolvingObjectsProgressRef.current.clear();
      evolvingObjectDataRef.current.clear();
      starTwinkleDataRef.current = [];

      const disposeParticleSystem = (systemRef: React.MutableRefObject<THREE_TYPE.Points | null>) => {
        if (systemRef.current) {
          systemRef.current.geometry.dispose();
          const material = systemRef.current.material;
          if (material && 'dispose' in material) {
            (material as THREE_TYPE.Material).dispose();
          }
          sceneRef.current?.remove(systemRef.current);
          systemRef.current = null;
        }
      };

      disposeParticleSystem(jetParticlesRef);
      disposeParticleSystem(starEmittedParticlesRef);
      disposeParticleSystem(shatterParticlesRef);

      sceneRef.current?.traverse(object => {
        if ((object as THREE_TYPE.Mesh).geometry) {
          (object as THREE_TYPE.Mesh).geometry.dispose();
        }
        const material = (object as THREE_TYPE.Mesh).material;
        if (material) {
          if (Array.isArray(material)) {
            material.forEach(m => m.dispose());
          } else {
            material.dispose();
          }
        }
      });

      composerRef.current?.dispose();

      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      diskParticleDataRef.current = [];
      THREEInstanceRef.current = null;
    };
  }, []);

  // Reference for recently collided pairs (not a ref, but needed for the closure)
  const recentlyCollidedPairs = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (blackHoleRef.current) {
      blackHoleRef.current.scale.setScalar(blackHoleRadiusRef_anim.current);
    }
    if (controlsRef.current) {
      controlsRef.current.minDistance = blackHoleRadiusRef_anim.current * 1.2;
    }
    if (cameraRef.current && cameraRef.current.position.length() < blackHoleRadiusRef_anim.current * 1.2) {
      const newPos = cameraRef.current.position.clone().normalize().multiplyScalar(blackHoleRadiusRef_anim.current * 1.2);
      cameraRef.current.position.copy(newPos);
      if (onCameraUpdateRef.current) {
        onCameraUpdateRef.current({ x: newPos.x, y: newPos.y, z: newPos.z });
      }
    }
  }, [blackHoleRadius]);

  useEffect(() => {
    createAndAddAccretionParticles(accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
  }, [accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity, createAndAddAccretionParticles]);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default ThreeBlackholeCanvas;
