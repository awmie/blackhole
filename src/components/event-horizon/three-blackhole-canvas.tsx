
"use client";

import React, { useRef, useEffect, useCallback } from 'react';
import type * as THREE_TYPE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlanetState, CollisionEvent } from '@/app/page';

// Gravitational Constants (tune these for desired simulation behavior)
const G_CONSTANT = 0.05; // Gravitational constant
const BLACK_HOLE_MASS_EQUIVALENT_FACTOR = 200; // Multiplied by radius for mass
const STAR_BASE_MASS = 150; // Base mass for a star of scale 1
const PLANET_BASE_MASS = 0.5;  // Base mass for a planet of scale 1
const MIN_GRAVITY_DISTANCE_SQ = 0.01; // To prevent division by zero / extreme forces

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

interface EvolvingObjectData { // Renamed from EvolvingPlanetData
  id: number;
  velocity: THREE_TYPE.Vector3; // Now stores full velocity vector
  position: THREE_TYPE.Vector3; // Stores current position
  ttl: number; // Time to live
  // Removed angle, radius as primary dynamic properties; position is key
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
  spawnedPlanets: PlanetState[]; // "Planets" here means any spawned celestial object
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

const NUM_PARTICLES = 50000;
const baseAngularSpeed = 1.0; // For accretion disk particles only
const minAngularSpeedFactor = 0.02; // For accretion disk particles only
const photonRingThreshold = 0.03;

const PULL_IN_FACTOR_DISSOLVING_BH = 8.0; // Stronger pull specifically for BH when dissolving
const DISSOLUTION_START_RADIUS_FACTOR = 1.2; // When an object gets this close to BH (factor of BH radius)
const DISSOLUTION_DURATION = 1.5; // Default time to dissolve once triggered

interface DiskParticleData { // For accretion disk only
  radius: number;
  angle: number;
  angularVelocity: number;
  yOffset: number;
}

const blackHoleVertexShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
varying vec4 v_screenPosition; 

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  v_worldPosition = worldPos.xyz;
  v_normal = normalize(mat3(modelMatrix) * normal);
  
  v_screenPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0); 
  
  gl_Position = v_screenPosition;
}
`;

const blackHoleFragmentShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
varying vec4 v_screenPosition;

uniform float u_time;
uniform vec3 u_cameraPosition;
uniform sampler2D u_starfieldTexture; 
uniform vec2 u_resolution;          
uniform float u_lensingStrength;    
uniform mat4 u_bhModelMatrix;      
uniform mat4 projectionMatrix; 

float simpleNoise(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 2.0;
    for (int i = 0; i < 6; i++) {
        value += amplitude * simpleNoise(st * frequency);
        st *= 2.2;
        amplitude *= 0.45;
    }
    return value;
}

void main() {
  vec3 normal = normalize(v_normal);
  vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);

  float rawFresnel = pow(1.0 - abs(dot(normal, viewDir)), 10.0);
  float rimProfile = smoothstep(0.15, 0.45, rawFresnel) * 1.8; 
  rimProfile = clamp(rimProfile, 0.0, 1.0); 

  float timeFactor = u_time * 0.07;

  vec2 noiseCoordBase1 = v_worldPosition.xz * 0.7 + timeFactor * 0.06;
  noiseCoordBase1.x += sin(v_worldPosition.y * 18.0 + timeFactor * 0.25) * 0.35;
  noiseCoordBase1.y += cos(v_worldPosition.x * 15.0 - timeFactor * 0.21) * 0.3;

  vec2 noiseCoordBase2 = v_worldPosition.yx * 1.2 - timeFactor * 0.04;
  noiseCoordBase2.y += cos(v_worldPosition.z * 14.0 - timeFactor * 0.18) * 0.3;
  noiseCoordBase2.x += sin(v_worldPosition.z * 16.0 + timeFactor * 0.28) * 0.25;
  
  float noiseVal1 = fbm(noiseCoordBase1);
  float noiseVal2 = fbm(noiseCoordBase2 * 1.4 + vec2(sin(timeFactor*0.12), cos(timeFactor*0.12)) * 0.6);
  float rawNoise = (noiseVal1 * 0.6 + noiseVal2 * 0.4);
  
  float lensedLightTextureModulation = 0.6 + rawNoise * 0.4; 
  
  vec4 bhCenterClip = projectionMatrix * viewMatrix * u_bhModelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 bhCenterNDC = bhCenterClip.xy / bhCenterClip.w;
  vec2 bhCenterScreenUV = bhCenterNDC * 0.5 + 0.5;

  vec2 fragNDC = v_screenPosition.xy / v_screenPosition.w;
  vec2 fragScreenUV = fragNDC * 0.5 + 0.5;
  
  float aspectRatio = u_resolution.x / u_resolution.y;
  
  vec2 dirFromCenterToFrag = fragScreenUV - bhCenterScreenUV;
  dirFromCenterToFrag.x *= aspectRatio; 
  
  float distFragToCenterScreen = length(dirFromCenterToFrag); 

  vec2 normalizedDirFromCenter = normalize(dirFromCenterToFrag); 
  
  vec2 tangentDir = vec2(-normalizedDirFromCenter.y, normalizedDirFromCenter.x); 
  float swirlFactor = 0.6; 
  
  float swirlPowerFalloff = smoothstep(0.0, 0.3, distFragToCenterScreen); 
  swirlFactor *= swirlPowerFalloff;

  vec2 swirledDir = normalize(normalizedDirFromCenter + tangentDir * swirlFactor);

  float centerFalloff = smoothstep(0.0, 0.05, distFragToCenterScreen); 
  float lensAmount = u_lensingStrength / (distFragToCenterScreen + 0.001) * centerFalloff;

  vec2 offsetVectorScreen = swirledDir * lensAmount;
  offsetVectorScreen.x /= aspectRatio; 

  vec2 sampleUV = fragScreenUV + offsetVectorScreen;
  sampleUV = clamp(sampleUV, 0.0, 1.0);

  vec3 lensedSceneColor = texture2D(u_starfieldTexture, sampleUV).rgb;
  vec3 texturedLensedColor = lensedSceneColor * lensedLightTextureModulation;
  vec3 coreColor = vec3(0.0, 0.0, 0.0);

  vec3 finalColor = mix(coreColor, texturedLensedColor, rimProfile);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

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

const SHATTER_PARTICLE_GRAVITY_FACTOR_BASE = 0.02; // Reduced further for less aggressive pull when far
const SHATTER_PARTICLE_NEAR_BH_THRESHOLD_FACTOR = 4.0; 
const SHATTER_PARTICLE_GRAVITY_BOOST_NEAR_BH = 25.0; // Stronger boost
const SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH = 0.3; 
const SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR = 1.1; 
const SHATTER_PARTICLE_LIFESPAN_REDUCTION_NEAR_ABSORPTION = 8.0;


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
  
  const foregroundSceneRef = useRef<THREE_TYPE.Scene | null>(null);
  const backgroundSceneRef = useRef<THREE_TYPE.Scene | null>(null); 

  const cameraRef = useRef<THREE_TYPE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);

  const blackHoleRef = useRef<THREE_TYPE.Mesh | null>(null);
  const blackHoleMaterialRef = useRef<THREE_TYPE.ShaderMaterial | null>(null);
  const accretionDiskRef = useRef<THREE_TYPE.Points | null>(null);
  const starsRef = useRef<THREE_TYPE.Points | null>(null); 

  const clockRef = useRef<THREE_TYPE.Clock | null>(null);
  const diskParticleDataRef = useRef<DiskParticleData[]>([]); // Accretion disk specific
  const celestialObjectsRef = useRef<Map<number, THREE_TYPE.Object3D>>(new Map()); // Renamed from planetMeshesRef
  const dissolvingObjectsProgressRef = useRef<Map<number, number>>(new Map());
  const evolvingObjectDataRef = useRef<Map<number, EvolvingObjectData>>(new Map()); // Renamed

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


  const sceneCaptureRenderTargetRef = useRef<THREE_TYPE.WebGLRenderTarget | null>(null); 
  const tempVectorRef = useRef<THREE_TYPE.Vector3 | null>(null);
  const tempVector2Ref = useRef<THREE_TYPE.Vector3 | null>(null); // For gravity calculations
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


  const spawnedObjectsRef_anim = useRef(spawnedPlanets); // Renamed from spawnedPlanetsRef_anim
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
    const scene = foregroundSceneRef.current; 
    if (!THREE || !scene) return;

    if (accretionDiskRef.current) {
      scene.remove(accretionDiskRef.current);
      accretionDiskRef.current.geometry.dispose();
      (accretionDiskRef.current.material as THREE_TYPE.Material).dispose();
      accretionDiskRef.current = null;
    }

    const particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_PARTICLES * 3);
    const colors = new Float32Array(NUM_PARTICLES * 4);
    diskParticleDataRef.current = [];

    const colorInner = new THREE.Color(1.0, 0.4, 0.8);
    const colorMid = new THREE.Color(0.6, 0.3, 0.9);
    const colorOuter = new THREE.Color(0.2, 0.1, 0.7);
    const colorPhotonRing = new THREE.Color(1.0, 0.95, 0.85);
    const outerFadeStartNormalized = 0.7;

    for (let i = 0; i < NUM_PARTICLES; i++) {
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
      } else {
        const innerEdgeFactor = 1.0 - Math.min(1.0, Math.max(0.0, (normalizedDist - photonRingThreshold) / 0.15));
         if (innerEdgeFactor > 0) {
            particleColor.r = Math.min(1.0, particleColor.r + innerEdgeFactor * 0.8);
            particleColor.g = Math.min(1.0, particleColor.g + innerEdgeFactor * 0.8);
            particleColor.b = Math.min(1.0, particleColor.b + innerEdgeFactor * 0.8);
        }
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
    const scene = foregroundSceneRef.current; 
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
            color: new THREE.Color(1,1,1),
            size: JET_PARTICLE_BASE_SIZE,
            active: false,
        });
        positions[i*3] = 0; positions[i*3+1] = -1000; positions[i*3+2] = 0;
        colorsAttribute[i*3] = 1; colorsAttribute[i*3+1] = 1; colorsAttribute[i*3+2] = 1;
        sizesAttribute[i] = JET_PARTICLE_BASE_SIZE;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));
    geometry.frustumCulled = false;

    jetMaterialRef.current = new THREE.PointsMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true, 
    });

    jetParticlesRef.current = new THREE.Points(geometry, jetMaterialRef.current);
    jetParticlesRef.current.visible = true; 
    jetParticlesRef.current.frustumCulled = false;
    scene.add(jetParticlesRef.current);
    lastJetParticleIndexRef.current = 0;
  }, []);

  const initStarEmittedParticles = useCallback(() => {
    const THREE = THREEInstanceRef.current;
    const scene = foregroundSceneRef.current; 
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
    geometry.frustumCulled = false;

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
        positions[i3] = 0; positions[i3+1] = -1000; positions[i3+2] = 0;
        colorsAttribute[i3] = 1; colorsAttribute[i3+1] = 1; colorsAttribute[i3+2] = 1;
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
    starEmittedParticlesRef.current.visible = true;
    starEmittedParticlesRef.current.frustumCulled = false; 
    scene.add(starEmittedParticlesRef.current);
    lastStarEmittedParticleIndexRef.current = 0;
  }, []);

  const initShatterParticles = useCallback(() => {
    const THREE = THREEInstanceRef.current;
    const scene = foregroundSceneRef.current;
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
    geometry.frustumCulled = false;

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
      positions[i * 3] = 0; positions[i * 3 + 1] = -1000; positions[i * 3 + 2] = 0;
      colorsAttribute[i*3] = 1; colorsAttribute[i*3+1] = 1; colorsAttribute[i*3+2] = 1;
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
    shatterParticlesRef.current.visible = true;
    shatterParticlesRef.current.frustumCulled = false;
    scene.add(shatterParticlesRef.current);
    lastShatterParticleIndexRef.current = 0;
  }, []);


  useEffect(() => {
    const foregroundScene = foregroundSceneRef.current;
    if (!foregroundScene || !THREEInstanceRef.current) return; 

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

    if (!clockRef.current) {
        clockRef.current = new THREE.Clock();
    }

    foregroundSceneRef.current = new THREE.Scene();
    backgroundSceneRef.current = new THREE.Scene(); 

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, blackHoleRadiusRef_anim.current * 1.5, blackHoleRadiusRef_anim.current * 4);
    cameraRef.current = camera;
    if (onCameraReady) { onCameraReady(camera); }
    if (onCameraUpdateRef.current) { onCameraUpdateRef.current({ x: camera.position.x, y: camera.position.y, z: camera.position.z });}


    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false; 
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    sceneCaptureRenderTargetRef.current = new THREE.WebGLRenderTarget(
        mountRef.current.clientWidth * window.devicePixelRatio,
        mountRef.current.clientHeight * window.devicePixelRatio
    );
    if (sceneCaptureRenderTargetRef.current) {
        sceneCaptureRenderTargetRef.current.texture.minFilter = THREE.LinearFilter;
        sceneCaptureRenderTargetRef.current.texture.magFilter = THREE.LinearFilter;
        sceneCaptureRenderTargetRef.current.texture.wrapS = THREE.ClampToEdgeWrapping;
        sceneCaptureRenderTargetRef.current.texture.wrapT = THREE.ClampToEdgeWrapping;
    }

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

    const blackHoleGeometry = new THREE.SphereGeometry(1, 64, 64); // Radius 1, scaled by blackHoleRadius prop
    blackHoleMaterialRef.current = new THREE.ShaderMaterial({
      vertexShader: blackHoleVertexShader,
      fragmentShader: blackHoleFragmentShader,
      uniforms: {
        u_time: { value: 0.0 },
        u_cameraPosition: { value: camera.position },
        u_starfieldTexture: { value: sceneCaptureRenderTargetRef.current?.texture || null }, 
        u_resolution: { value: new THREE.Vector2(mountRef.current.clientWidth, mountRef.current.clientHeight) },
        u_lensingStrength: { value: 0.12 }, 
        u_bhModelMatrix: { value: new THREE.Matrix4() },
      },
    });
    const blackHoleMesh = new THREE.Mesh(blackHoleGeometry, blackHoleMaterialRef.current);
    blackHoleMesh.position.set(0,0,0); // Black hole at origin
    foregroundSceneRef.current.add(blackHoleMesh);
    blackHoleRef.current = blackHoleMesh;

    createAndAddAccretionParticles(accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);

    const starsGeometry = new THREE.BufferGeometry();
    const starVertices = [];
    for (let i = 0; i < 150000; i++) { 
        const r = 200 + Math.random() * 600; 
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * Math.PI;
        starVertices.push(r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(theta));
    }
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: true });
    starsRef.current = new THREE.Points(starsGeometry, starsMaterial);
    backgroundSceneRef.current.add(starsRef.current); 

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    foregroundSceneRef.current.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    foregroundSceneRef.current.add(directionalLight);

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
      const plane = new THREE_INSTANCE.Plane(new THREE_INSTANCE.Vector3(0, 1, 0), 0); // Assume spawn on XZ plane for now
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
      const renderer_anim = rendererRef.current;
      const fgScene_anim = foregroundSceneRef.current;
      const bgScene_anim = backgroundSceneRef.current; 
      const mainCam_anim = cameraRef.current;
      const sceneRT_anim = sceneCaptureRenderTargetRef.current;
      const bhMaterial_anim = blackHoleMaterialRef.current;
      const bh_anim = blackHoleRef.current;
      const _tempVec = tempVectorRef.current;
      const _tempVec2 = tempVector2Ref.current; // For gravity
      const _tempQuat = tempQuaternionRef.current;


      if (!clockRef.current || !THREE_ANIM || !renderer_anim || !fgScene_anim || !bgScene_anim || !mainCam_anim || !sceneRT_anim || !bhMaterial_anim || !bh_anim || !_tempVec || !_tempVec2 || !_tempQuat) return;

      const deltaTime = clockRef.current.getDelta();
      const elapsedTime = clockRef.current.getElapsedTime();
      const effectiveDeltaTime = deltaTime * simulationSpeedRef_anim.current;


      controlsRef.current?.update();
      
      bhMaterial_anim.uniforms.u_time.value = elapsedTime;
      bhMaterial_anim.uniforms.u_cameraPosition.value.copy(mainCam_anim.position);
      bhMaterial_anim.uniforms.u_resolution.value.set(renderer_anim.domElement.width, renderer_anim.domElement.height);
      bhMaterial_anim.uniforms.u_bhModelMatrix.value.copy(bh_anim.matrixWorld); // bh_anim.matrixWorld should be identity if it's at origin and not rotated/scaled here


      // Accretion disk animation (unchanged from previous simpler orbital model)
      if (accretionDiskRef.current?.geometry) {
        const positions = accretionDiskRef.current.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < diskParticleDataRef.current.length; i++) {
          const pData = diskParticleDataRef.current[i];
          pData.angle += pData.angularVelocity * effectiveDeltaTime; // Use effectiveDeltaTime
          const i3 = i * 3;
          positions[i3] = pData.radius * Math.cos(pData.angle);
          positions[i3 + 2] = pData.radius * Math.sin(pData.angle);
        }
        accretionDiskRef.current.geometry.attributes.position.needsUpdate = true;
      }

      // N-body physics for spawned objects
      spawnedObjectsRef_anim.current.forEach(objProp => {
        const object3D = celestialObjectsRef.current.get(objProp.id);
        let evolvingData = evolvingObjectDataRef.current.get(objProp.id);

        if (!object3D || !evolvingData) return;

        evolvingData.ttl -= deltaTime; // TTL uses raw deltaTime

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

            // Simplified pull towards black hole when dissolving
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
                        particle.position.copy(object3D.position); // Emit from current position
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
            // N-body gravitational physics for non-dissolving objects
            const acceleration = _tempVec2.set(0, 0, 0);
            const currentMass = objProp.type === 'star' 
                ? STAR_BASE_MASS * currentStarMassFactor 
                : PLANET_BASE_MASS * (objProp.initialScale.x / 0.1); // Basic mass scaling for planets by size

            // Gravity from Black Hole
            const blackHoleEffectiveMass = BLACK_HOLE_MASS_EQUIVALENT_FACTOR * blackHoleActualRadius;
            _tempVec.copy(bh_anim.position).sub(evolvingData.position);
            let distSqToBH = _tempVec.lengthSq();
            distSqToBH = Math.max(distSqToBH, MIN_GRAVITY_DISTANCE_SQ + blackHoleActualRadius * blackHoleActualRadius); // Prevent pulling from inside
            const forceMagBH = (G_CONSTANT * blackHoleEffectiveMass * currentMass) / distSqToBH;
            acceleration.addScaledVector(_tempVec.normalize(), forceMagBH / currentMass);


            // Gravity from other Stars
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
            
            // Check for dissolution or absorption by TTL or proximity
            if (evolvingData.position.lengthSq() < (blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR * blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR) && onSetPlanetDissolvingRef.current) {
                 onSetPlanetDissolvingRef.current(objProp.id, true);
            } else if (evolvingData.ttl <= 0 || evolvingData.position.lengthSq() < blackHoleActualRadius * blackHoleActualRadius * 0.01) { // Very close to center
                if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(objProp.id);
                evolvingObjectDataRef.current.delete(objProp.id);
                dissolvingObjectsProgressRef.current.delete(objProp.id);
            }
        }
        object3D.position.copy(evolvingData.position);
        object3D.scale.set( // Update scale continuously for stars losing mass
              objProp.initialScale.x * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1),
              objProp.initialScale.y * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1),
              objProp.initialScale.z * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1)
        );

        // Basic rotation to look at movement direction (optional)
        if (evolvingData.velocity.lengthSq() > 0.001 && !objProp.isDissolving) {
             _tempVec.copy(evolvingData.position).add(evolvingData.velocity); // Look ahead
             object3D.lookAt(_tempVec);
        } else if (objProp.isDissolving) {
             object3D.quaternion.slerp(_tempQuat.setFromUnitVectors(new THREE_ANIM.Vector3(0,0,1), new THREE_ANIM.Vector3(0,0,1)), 0.1); // Reset rotation
        }


        if(onUpdatePlanetPositionRef.current) { 
             onUpdatePlanetPositionRef.current(objProp.id, 
                {x: evolvingData.position.x, y: evolvingData.position.y, z: evolvingData.position.z},
                {x: evolvingData.velocity.x, y: evolvingData.velocity.y, z: evolvingData.velocity.z}
             );
        }
      });

      // Star emitted particles update (mass loss visualization, not gravity driven by these particles)
      if (starEmittedParticlesRef.current?.geometry && starEmittedParticleMaterialRef.current && starEmittedParticleDataRef.current.length > 0 && THREE_ANIM) {
        const positions = starEmittedParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = starEmittedParticlesRef.current.geometry.attributes.color.array as Float32Array;
        const sizes = starEmittedParticlesRef.current.geometry.attributes.size.array as Float32Array;
        let hasActiveStarParticles = false;

        starEmittedParticleDataRef.current.forEach((p, i) => {
            if (p.active && p.life > 0) {
                hasActiveStarParticles = true;
                // Gravity towards black hole for these emitted particles
                _tempVec.copy(bh_anim.position).sub(p.position);
                const distanceSq = Math.max(0.1, p.position.lengthSq());
                const gravityFactor = STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR;
                _tempVec.normalize().multiplyScalar(gravityFactor / distanceSq);
                p.velocity.addScaledVector(_tempVec, effectiveDeltaTime);
                p.position.addScaledVector(p.velocity, effectiveDeltaTime);

                p.life -= deltaTime / p.initialLife; 
                const i3 = i * 3;
                positions[i3] = p.position.x; positions[i3 + 1] = p.position.y; positions[i3 + 2] = p.position.z;
                const fade = Math.max(0, p.life); 
                colors[i3] = p.color.r * fade; colors[i3 + 1] = p.color.g * fade; colors[i3 + 2] = p.color.b * fade;
                sizes[i] = p.size * fade;
                if (p.life <= 0 || p.position.lengthSq() < (blackHoleRadiusRef_anim.current * blackHoleRadiusRef_anim.current * 0.01) ) {
                    p.active = false; positions[i3+1] = -1000; 
                }
            } else if (p.active === false && positions[i*3+1] > -999) { 
                 positions[i*3+1] = -1000; hasActiveStarParticles = true; 
            }
        });
        if(hasActiveStarParticles){
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
                activeJetsVisualsNeedUpdate = true; // Assume update needed if trying to emit
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
                            const randomOffset = new THREE_ANIM.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5)
                                                    .normalize().multiplyScalar(JET_VELOCITY_RANDOM_OFFSET_MAGNITUDE);
                            velDir.add(randomOffset).normalize();
                            
                            jetP.velocity.copy(velDir).multiplyScalar(JET_SPEED * (0.7 + Math.random() * 0.6));
                            jetP.life = 1.0; 
                            jetP.initialLife = JET_LIFESPAN * (0.6 + Math.random() * 0.8);
                            jetP.color.setHSL(Math.random() * 0.15 + 0.50, 0.95, 0.85); 
                            jetP.size = JET_PARTICLE_BASE_SIZE; 

                            positions[pIndex*3] = jetP.position.x; 
                            positions[pIndex*3+1] = jetP.position.y; 
                            positions[pIndex*3+2] = jetP.position.z;
                            
                            lastJetParticleIndexRef.current = (pIndex + 1) % JET_PARTICLE_COUNT;
                        } else if (jetP && jetP.active) {
                            break; 
                        }
                    }
                }
            }

            jetParticleDataRef.current.forEach((p, i) => {
                const i3 = i * 3;
                if (p.active && p.life > 0) {
                    activeJetsVisualsNeedUpdate = true;
                    p.position.addScaledVector(p.velocity, effectiveDeltaTime); // Use effectiveDeltaTime
                    p.life -= deltaTime / p.initialLife; // Life uses raw deltaTime
                    
                    positions[i3] = p.position.x; 
                    positions[i3 + 1] = p.position.y; 
                    positions[i3 + 2] = p.position.z;
                    
                    const fade = Math.max(0, p.life);
                    colorsAttribute[i3] = p.color.r * fade; 
                    colorsAttribute[i3 + 1] = p.color.g * fade; 
                    colorsAttribute[i3 + 2] = p.color.b * fade;
                    sizesAttribute[i] = p.size * fade; 
                    
                    if (p.life <= 0) { 
                        p.active = false; 
                        positions[i3+1] = -1000; 
                    }
                } else if (!p.active && positions[i3+1] > -999) { 
                     positions[i3+1] = -1000; 
                     activeJetsVisualsNeedUpdate = true;
                }
            });
            
            jetParticlesRef.current.visible = true; 
            if (activeJetsVisualsNeedUpdate) { 
              jetParticlesRef.current.geometry.attributes.position.needsUpdate = true;
              jetParticlesRef.current.geometry.attributes.color.needsUpdate = true;
              jetParticlesRef.current.geometry.attributes.size.needsUpdate = true;
            }
        }

      // Process collision events for shatter particles
      if (collisionEventsRef.current.length > 0 && shatterParticlesRef.current?.geometry && THREE_ANIM) {
        collisionEventsRef.current.forEach(event => {
          const collisionTHREEPoint = new THREE_ANIM.Vector3(event.point.x, event.point.y, event.point.z);
          const color1 = new THREE_ANIM.Color(event.color1);
          const color2 = new THREE_ANIM.Color(event.color2);

          for (let i = 0; i < SHATTER_PARTICLES_PER_COLLISION; i++) {
            const pIndex = lastShatterParticleIndexRef.current;
            const particle = shatterParticleDataRef.current[pIndex];

            if (particle && !particle.active) {
              particle.active = true;
              particle.position.copy(collisionTHREEPoint);
              particle.velocity.set(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
              ).normalize().multiplyScalar(SHATTER_PARTICLE_SPEED_MIN + Math.random() * (SHATTER_PARTICLE_SPEED_MAX - SHATTER_PARTICLE_SPEED_MIN));
              particle.initialLife = SHATTER_PARTICLE_LIFESPAN_MIN + Math.random() * (SHATTER_PARTICLE_LIFESPAN_MAX - SHATTER_PARTICLE_LIFESPAN_MIN);
              particle.life = 1.0; 
              particle.color.copy(Math.random() > 0.5 ? color1 : color2); 
              particle.size = SHATTER_PARTICLE_SIZE_MIN + Math.random() * (SHATTER_PARTICLE_SIZE_MAX - SHATTER_PARTICLE_SIZE_MIN); 
            }
            lastShatterParticleIndexRef.current = (pIndex + 1) % SHATTER_PARTICLE_POOL_SIZE;
          }
          if (onCollisionEventProcessedRef.current) {
            onCollisionEventProcessedRef.current(event.id);
          }
        });
      }
      
      // Update shatter particles
      if (shatterParticlesRef.current?.geometry && shatterParticleDataRef.current.length > 0 && THREE_ANIM && tempVectorRef.current) {
        const positions = shatterParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = shatterParticlesRef.current.geometry.attributes.color.array as Float32Array;
        const sizes = shatterParticlesRef.current.geometry.attributes.size.array as Float32Array;
        let hasActiveShatterParticles = false;
        const blackHoleActualRadius = blackHoleRadiusRef_anim.current;

        shatterParticleDataRef.current.forEach((p, i) => {
          const i3 = i * 3;
          if (p.active && p.life > 0) {
            hasActiveShatterParticles = true;
            
            const distanceToBHSq = p.position.lengthSq(); // Distance to origin (black hole center)
            let effectiveGravityFactor = SHATTER_PARTICLE_GRAVITY_FACTOR_BASE;

            const nearBHThresholdRadius = blackHoleActualRadius * SHATTER_PARTICLE_NEAR_BH_THRESHOLD_FACTOR;
            const isNearBH = distanceToBHSq < (nearBHThresholdRadius * nearBHThresholdRadius);

            const quickAbsorptionRadius = blackHoleActualRadius * SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR;
            const isVeryCloseToBH = distanceToBHSq < (quickAbsorptionRadius * quickAbsorptionRadius);

            if (isNearBH) {
                effectiveGravityFactor *= SHATTER_PARTICLE_GRAVITY_BOOST_NEAR_BH;
                if (SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH > 0 && tempVectorRef.current) {
                    const tangentDirection = tempVectorRef.current.set(-p.position.z, 0, p.position.x).normalize(); 
                    const closenessFactor = Math.max(0, 1.0 - (Math.sqrt(distanceToBHSq) / nearBHThresholdRadius));
                    const spiralMagnitude = SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH * closenessFactor * effectiveGravityFactor * effectiveDeltaTime * 0.1; // Spiral is subtle
                    p.velocity.addScaledVector(tangentDirection, spiralMagnitude);
                }
            }
            
            const forceDirection = tempVectorRef.current.copy(p.position).negate(); 
            const invDistanceSq = 1.0 / Math.max(0.01, distanceToBHSq); 
            forceDirection.normalize().multiplyScalar(effectiveGravityFactor * blackHoleActualRadius * invDistanceSq); // Gravity proportional to BH radius

            p.velocity.addScaledVector(forceDirection, effectiveDeltaTime);
            p.position.addScaledVector(p.velocity, effectiveDeltaTime);
            
            let lifeReductionFactor = 1.0;
            if (isVeryCloseToBH) {
                lifeReductionFactor = SHATTER_PARTICLE_LIFESPAN_REDUCTION_NEAR_ABSORPTION;
            }
            p.life -= (deltaTime / p.initialLife) * lifeReductionFactor; // Life uses raw deltaTime

            positions[i3] = p.position.x; positions[i3 + 1] = p.position.y; positions[i3 + 2] = p.position.z;
            const fade = Math.max(0, p.life);
            colors[i3] = p.color.r * fade; colors[i3 + 1] = p.color.g * fade; colors[i3 + 2] = p.color.b * fade;
            sizes[i] = p.size * fade;

            if (p.life <= 0 || distanceToBHSq < (blackHoleActualRadius * blackHoleActualRadius * 0.9)) {
              p.active = false; positions[i3+1] = -1000; 
            }
          } else if (!p.active && positions[i3+1] > -999) {
             positions[i3+1] = -1000; hasActiveShatterParticles = true;
          }
        });

        if (hasActiveShatterParticles) {
          shatterParticlesRef.current.geometry.attributes.position.needsUpdate = true;
          shatterParticlesRef.current.geometry.attributes.color.needsUpdate = true;
          shatterParticlesRef.current.geometry.attributes.size.needsUpdate = true;
        }
      }


      // Pass 1: Capture the scene (stars, disk, planets etc. WITHOUT the black hole) to sceneRT_anim
      if (bh_anim) bh_anim.visible = false; 
      renderer_anim.setRenderTarget(sceneRT_anim);
      renderer_anim.clear();
      if (bgScene_anim) renderer_anim.render(bgScene_anim, mainCam_anim); 
      renderer_anim.clearDepth(); 
      if (fgScene_anim) renderer_anim.render(fgScene_anim, mainCam_anim); 
      if (bh_anim) bh_anim.visible = true; 

      // Pass 2: Render background stars to the main screen
      renderer_anim.setRenderTarget(null); 
      renderer_anim.clear(); 
      if (bgScene_anim) renderer_anim.render(bgScene_anim, mainCam_anim); 

      // Pass 3: Render foreground scene (including black hole with lensing) to screen, over the stars
      renderer_anim.clearDepth(); 
      if (fgScene_anim) renderer_anim.render(fgScene_anim, mainCam_anim); 
    };
    animate();

    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current && sceneCaptureRenderTargetRef.current && blackHoleMaterialRef.current) {
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
        sceneCaptureRenderTargetRef.current.setSize(width * window.devicePixelRatio, height * window.devicePixelRatio);
        blackHoleMaterialRef.current.uniforms.u_resolution.value.set(width, height);
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
        foregroundSceneRef.current?.remove(object); 
        if (object instanceof THREE_TYPE.Group) {
          object.traverse(child => {
             if (child instanceof THREE_TYPE.Mesh) {
                child.geometry?.dispose();
                 if (Array.isArray(child.material)) { child.material.forEach(m => m.dispose()); } 
                 else { (child.material as THREE_TYPE.Material)?.dispose(); }
             }
          });
        } else if (object instanceof THREE_TYPE.Mesh) {
          object.geometry?.dispose();
          if (object.material) { (object.material as THREE_TYPE.Material).dispose(); }
        }
      });
      celestialObjectsRef.current.clear();
      dissolvingObjectsProgressRef.current.clear();
      evolvingObjectDataRef.current.clear();

      const disposeParticleSystem = (systemRef: React.MutableRefObject<THREE_TYPE.Points | null>) => {
        const THREE_CLEANUP_PARTICLES = THREEInstanceRef.current;
        if (systemRef.current) {
            systemRef.current.geometry.dispose();
            if (THREE_CLEANUP_PARTICLES && systemRef.current.material instanceof THREE_CLEANUP_PARTICLES.Material) {
                 (systemRef.current.material as THREE_TYPE.Material).dispose();
            }
            foregroundSceneRef.current?.remove(systemRef.current);
            systemRef.current = null;
        }
      };

      disposeParticleSystem(jetParticlesRef);
      disposeParticleSystem(starEmittedParticlesRef);
      disposeParticleSystem(shatterParticlesRef);


      sceneCaptureRenderTargetRef.current?.dispose();
      
      foregroundSceneRef.current?.traverse(object => {
        const THREE_CLEANUP = THREEInstanceRef.current;
        if (!THREE_CLEANUP) return;
        if (object instanceof THREE_CLEANUP.Mesh || object instanceof THREE_CLEANUP.Points || object instanceof THREE_CLEANUP.LineSegments) {
            if (object.geometry) object.geometry.dispose();
            const material = object.material as THREE_TYPE.Material | THREE_TYPE.Material[];
            if (material) {
              if (Array.isArray(material)) { material.forEach(mat => mat.dispose()); } 
              else { material.dispose(); }
            }
          }
      });

      backgroundSceneRef.current?.traverse(object => {
         const THREE_CLEANUP_BG = THREEInstanceRef.current;
         if (!THREE_CLEANUP_BG) return;
         if (object instanceof THREE_CLEANUP_BG.Points) {
            if (object.geometry) object.geometry.dispose();
            if (object.material) (object.material as THREE_TYPE.Material).dispose();
         }
      });

      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      diskParticleDataRef.current = [];
      THREEInstanceRef.current = null;
    };
  }, []); 

  useEffect(() => {
    if (blackHoleRef.current) {
      // Scale the visual representation of the black hole
      blackHoleRef.current.scale.set(blackHoleRadiusRef_anim.current, blackHoleRadiusRef_anim.current, blackHoleRadiusRef_anim.current);
    }
    if (controlsRef.current) {
        controlsRef.current.minDistance = blackHoleRadiusRef_anim.current * 1.2;
    }
     if (cameraRef.current && cameraRef.current.position.length() < blackHoleRadiusRef_anim.current * 1.2) {
        const newPos = cameraRef.current.position.clone().normalize().multiplyScalar(blackHoleRadiusRef_anim.current * 1.2);
        cameraRef.current.position.copy(newPos);
        if (onCameraUpdateRef.current) {
            onCameraUpdateRef.current({x: newPos.x, y: newPos.y, z:newPos.z});
        }
    }
  }, [blackHoleRadius]);

  useEffect(() => {
    if (foregroundSceneRef.current && THREEInstanceRef.current) { 
       createAndAddAccretionParticles(
        accretionDiskInnerRadius,
        accretionDiskOuterRadius,
        accretionDiskOpacity
      );
    }
  }, [accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity, createAndAddAccretionParticles]);


  useEffect(() => {
    const scene = foregroundSceneRef.current; 
    const THREE_OBJECTS = THREEInstanceRef.current; // Renamed from THREE_PLANETS
    if (!scene || !THREE_OBJECTS) return;

    const currentObjectIds = new Set(Array.from(celestialObjectsRef.current.keys()));
    const incomingObjectIds = new Set(spawnedPlanets.map(p => p.id)); // spawnedPlanets are the props

    spawnedPlanets.forEach(objProp => { // objProp is from props
      let object3D = celestialObjectsRef.current.get(objProp.id);
      const currentStarMassFactor = (objProp.type === 'star' ? objProp.currentMassFactor : 1.0) ?? 1.0;

      if (!object3D) { // Object doesn't exist in scene, create it
        const sphereGeometry = new THREE_OBJECTS.SphereGeometry(1, 16, 16); // Unit sphere
        let sphereMaterial;

        if (objProp.type === 'star') {
          const starGroup = new THREE_OBJECTS.Group(); 
          sphereMaterial = new THREE_OBJECTS.MeshBasicMaterial({ color: objProp.color }); 
          const starSphere = new THREE_OBJECTS.Mesh(sphereGeometry, sphereMaterial);
          starGroup.add(starSphere);
          object3D = starGroup;
        } else { 
          sphereMaterial = new THREE_OBJECTS.MeshStandardMaterial({ color: objProp.color, roughness: 0.5, metalness: 0.1 });
          object3D = new THREE_OBJECTS.Mesh(sphereGeometry, sphereMaterial);
        }
        
        // Set initial position and scale from objProp
        object3D.position.set(objProp.position!.x, objProp.position!.y, objProp.position!.z);
        object3D.scale.set(
            objProp.initialScale.x * currentStarMassFactor,
            objProp.initialScale.y * currentStarMassFactor,
            objProp.initialScale.z * currentStarMassFactor
        );

        scene.add(object3D);
        celestialObjectsRef.current.set(objProp.id, object3D);
        (object3D as any).userData = { objectId: objProp.id }; 

        evolvingObjectDataRef.current.set(objProp.id, {
          id: objProp.id,
          position: new THREE_OBJECTS.Vector3(objProp.position!.x, objProp.position!.y, objProp.position!.z),
          velocity: new THREE_OBJECTS.Vector3(objProp.velocity.x, objProp.velocity.y, objProp.velocity.z),
          ttl: objProp.timeToLive,
        });
      } else { // Object exists, update its properties if necessary (e.g. color, mass for stars)
        const evolvingData = evolvingObjectDataRef.current.get(objProp.id);
        if (evolvingData) {
            // Update color if changed (though color typically doesn't change post-spawn)
            if (objProp.type === 'star' && object3D instanceof THREE_OBJECTS.Group) {
                const starSphere = object3D.children.find(child => child instanceof THREE_OBJECTS.Mesh) as THREE_TYPE.Mesh;
                if (starSphere && starSphere.material instanceof THREE_OBJECTS.MeshBasicMaterial) {
                    if (starSphere.material.color.getHexString() !== new THREE_OBJECTS.Color(objProp.color).getHexString()){
                        starSphere.material.color.set(objProp.color);
                    }
                }
            } else if (objProp.type === 'planet' && object3D instanceof THREE_OBJECTS.Mesh) {
                if (object3D.material instanceof THREE_OBJECTS.MeshStandardMaterial) { 
                     if (object3D.material.color.getHexString() !== new THREE_OBJECTS.Color(objProp.color).getHexString()){
                        object3D.material.color.set(objProp.color);
                    }
                }
            }
            // Update TTL if it changed in props (e.g. due to dissolution trigger)
            if (objProp.isDissolving && evolvingData.ttl > objProp.timeToLive) { 
                 evolvingData.ttl = objProp.timeToLive;
            } else if (!objProp.isDissolving && evolvingData.ttl !== objProp.timeToLive) { // Reset TTL if not dissolving
                evolvingData.ttl = objProp.timeToLive;
            }
            // Position and velocity are driven by physics loop, but ensure scale reflects mass changes for stars
            object3D.scale.set(
              objProp.initialScale.x * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1),
              objProp.initialScale.y * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1),
              objProp.initialScale.z * currentStarMassFactor * (objProp.isDissolving ? (1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0)) : 1)
            );
        }
      }
    });
    
    // Remove objects from scene if they are no longer in spawnedPlanets prop
    currentObjectIds.forEach(id => {
      if (!incomingObjectIds.has(id)) {
        const object3D = celestialObjectsRef.current.get(id);
        if (object3D) {
          scene.remove(object3D); 
          if (object3D instanceof THREE_OBJECTS.Group) { 
            object3D.traverse(child => {
              if (child instanceof THREE_OBJECTS.Mesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) { child.material.forEach(m => m.dispose());} 
                else { (child.material as THREE_TYPE.Material)?.dispose(); }
              }
            });
          } else if (object3D instanceof THREE_OBJECTS.Mesh) { 
            object3D.geometry?.dispose();
             if (object3D.material) { (object3D.material as THREE_TYPE.Material).dispose(); }
          }
          celestialObjectsRef.current.delete(id);
        }
        evolvingObjectDataRef.current.delete(id);
        dissolvingObjectsProgressRef.current.delete(id);
      }
    });
  }, [spawnedPlanets]); // Re-run when the spawnedPlanets prop array changes


  return <div ref={mountRef} className="w-full h-full outline-none" data-ai-hint="galaxy space" />;
};

export default ThreeBlackholeCanvas;
    
