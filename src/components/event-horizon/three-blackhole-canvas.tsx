
"use client";

import React, { useRef, useEffect, useCallback } from 'react';
import type * as THREE_TYPE from 'three'; // Use type import for THREE
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlanetState } from '@/app/page';


export interface JetParticleState {
  id: number;
  position: THREE_TYPE.Vector3;
  velocity: THREE_TYPE.Vector3;
  life: number;
  initialLife: number;
  color: THREE_TYPE.Color;
  size: number;
}

interface EvolvingPlanetData {
  id: number; 
  angle: number;
  radius: number;
  ttl: number;
}

interface StarEmittedParticleState {
  id: number;
  position: THREE_TYPE.Vector3;
  velocity: THREE_TYPE.Vector3;
  life: number;
  initialLife: number; // Used to differentiate glow vs dissolution particles
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
}

const NUM_PARTICLES = 50000;
const baseAngularSpeed = 1.0;
const minAngularSpeedFactor = 0.02;
const photonRingThreshold = 0.03;

const PULL_IN_FACTOR_DISSOLVING = 0.1;
const CONTINUOUS_ORBITAL_DECAY_RATE = 0.002; 

const DISSOLUTION_START_RADIUS_FACTOR = 1.01; 
const DISSOLUTION_DURATION = 1.5; 

interface DiskParticleData {
  radius: number;
  angle: number;
  angularVelocity: number;
  yOffset: number;
}

const blackHoleVertexShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  v_worldPosition = worldPos.xyz;
  v_normal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const blackHoleFragmentShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
uniform float u_time;
uniform vec3 u_cameraPosition;

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

  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 7.0) * 3.5; 
  fresnel = clamp(fresnel, 0.0, 1.0);

  float timeFactor = u_time * 0.07; 

  vec2 noiseCoordBase1 = v_worldPosition.xz * 0.7 + timeFactor * 0.06;
  noiseCoordBase1.x += sin(v_worldPosition.y * 18.0 + timeFactor * 0.25) * 0.35;
  noiseCoordBase1.y += cos(v_worldPosition.x * 15.0 - timeFactor * 0.21) * 0.3;

  vec2 noiseCoordBase2 = v_worldPosition.yx * 1.2 - timeFactor * 0.04;
  noiseCoordBase2.y += cos(v_worldPosition.z * 14.0 - timeFactor * 0.18) * 0.3;
  noiseCoordBase2.x += sin(v_worldPosition.z * 16.0 + timeFactor * 0.28) * 0.25;

  float noiseVal1 = fbm(noiseCoordBase1);
  float noiseVal2 = fbm(noiseCoordBase2 * 1.4 + vec2(sin(timeFactor*0.12), cos(timeFactor*0.12)) * 0.6);

  float radialDistFactor = smoothstep(0.8, 1.0, length(v_worldPosition.xy / length(vec2(1.0,1.0)))); 
  float combinedNoise = (noiseVal1 * 0.6 + noiseVal2 * 0.4) * (0.3 + radialDistFactor * 0.7);
  combinedNoise = smoothstep(0.3, 0.7, combinedNoise); 

  vec3 coreColor = vec3(0.0, 0.0, 0.0); 
  vec3 lensedLightColor = vec3(1.0, 0.75, 0.9); 

  float effectIntensity = fresnel * combinedNoise * 2.5; 
  
  vec3 finalColor = mix(coreColor, lensedLightColor, clamp(effectIntensity, 0.0, 1.0));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const JET_PARTICLE_COUNT = 2000;
const JET_LIFESPAN = 2;
const JET_SPEED = 5;

// Star particle constants
const STAR_EMITTED_PARTICLE_COUNT = 10000; // Increased capacity

// Dissolution particle properties
const STAR_DISSOLUTION_EMIT_RATE_PER_FRAME = 10; 
const STAR_DISSOLUTION_PARTICLE_LIFESPAN = 1.5;
const STAR_DISSOLUTION_PARTICLE_INITIAL_SPEED = 0.3;
const STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR = 0.5;

// Continuous light glow particle properties
const STAR_LIGHT_EMIT_RATE_PER_FRAME = 5; // Rate for continuous glow
const STAR_LIGHT_PARTICLE_LIFESPAN = 3.0; // Longer life for glow
const STAR_LIGHT_PARTICLE_INITIAL_SPEED = 0.05; // Slower speed for glow
const STAR_LIGHT_PARTICLE_GRAVITY_FACTOR = 0.02; // Weaker gravity for glow particles
const STAR_LIGHT_PARTICLE_SIZE = 0.01;


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
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE_TYPE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE_TYPE.Scene | null>(null);
  const cameraRef = useRef<THREE_TYPE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);

  const blackHoleRef = useRef<THREE_TYPE.Mesh | null>(null);
  const blackHoleMaterialRef = useRef<THREE_TYPE.ShaderMaterial | null>(null);
  const accretionDiskRef = useRef<THREE_TYPE.Points | null>(null);
  const starsRef = useRef<THREE_TYPE.Points | null>(null);

  const clockRef = useRef<THREE_TYPE.Clock | null>(null);
  const diskParticleDataRef = useRef<DiskParticleData[]>([]);
  const planetMeshesRef = useRef<Map<number, THREE_TYPE.Object3D>>(new Map());
  const dissolvingObjectsProgressRef = useRef<Map<number, number>>(new Map());
  const evolvingPlanetDataRef = useRef<Map<number, EvolvingPlanetData>>(new Map());


  const jetParticlesRef = useRef<THREE_TYPE.Points | null>(null);
  const jetParticleDataRef = useRef<JetParticleState[]>([]);
  const jetMaterialRef = useRef<THREE_TYPE.PointsMaterial | null>(null);

  const starEmittedParticlesRef = useRef<THREE_TYPE.Points | null>(null);
  const starEmittedParticleDataRef = useRef<StarEmittedParticleState[]>([]);
  const starEmittedParticleMaterialRef = useRef<THREE_TYPE.PointsMaterial | null>(null);
  const lastStarEmittedParticleIndexRef = useRef(0);


  const onShiftClickSpawnAtPointRef = useRef(onShiftClickSpawnAtPoint);
  const onCameraUpdateRef = useRef(onCameraUpdate);
  const onAbsorbPlanetRef = useRef(onAbsorbPlanet);
  const onSetPlanetDissolvingRef = useRef(onSetPlanetDissolving);
  
  const spawnedPlanetsRef_anim = useRef(spawnedPlanets);
  useEffect(() => {
    spawnedPlanetsRef_anim.current = spawnedPlanets;
  }, [spawnedPlanets]);


  useEffect(() => {
    onShiftClickSpawnAtPointRef.current = onShiftClickSpawnAtPoint;
  }, [onShiftClickSpawnAtPoint]);

  useEffect(() => {
    onCameraUpdateRef.current = onCameraUpdate;
  }, [onCameraUpdate]);

  useEffect(() => {
    onAbsorbPlanetRef.current = onAbsorbPlanet;
  }, [onAbsorbPlanet]);

  useEffect(() => {
    onSetPlanetDissolvingRef.current = onSetPlanetDissolving;
  }, [onSetPlanetDissolving]);


  const createAndAddAccretionParticles = useCallback((
    scene: THREE_TYPE.Scene,
    innerR: number,
    outerR: number,
    opacity: number
  ) => {
    const THREE = require('three') as typeof THREE_TYPE;
    if (!THREE) return;

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

  const initJetParticles = useCallback((scene: THREE_TYPE.Scene) => {
    const THREE = require('three') as typeof THREE_TYPE;
    if (!THREE) return;
    
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

    jetParticleDataRef.current = [];
    for (let i = 0; i < JET_PARTICLE_COUNT; i++) {
        const life = 0;
        const initialLife = JET_LIFESPAN * (0.5 + Math.random() * 0.5);

        jetParticleDataRef.current.push({
            id: i,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            life,
            initialLife,
            color: new THREE.Color(1,1,1),
            size: 0.02 + Math.random() * 0.03,
        });
        positions[i*3] = 0; positions[i*3+1] = 0; positions[i*3+2] = 0;
        colorsAttribute[i*3] = 1; colorsAttribute[i*3+1] = 1; colorsAttribute[i*3+2] = 1;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));

    jetMaterialRef.current = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
    });

    jetParticlesRef.current = new THREE.Points(geometry, jetMaterialRef.current);
    jetParticlesRef.current.visible = false;
    scene.add(jetParticlesRef.current);
  }, []);

  const initStarEmittedParticles = useCallback((scene: THREE_TYPE.Scene) => {
    const THREE = require('three') as typeof THREE_TYPE;
    if (!THREE) return;

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

    starEmittedParticleDataRef.current = [];
    for (let i = 0; i < STAR_EMITTED_PARTICLE_COUNT; i++) {
        starEmittedParticleDataRef.current.push({
            id: i,
            position: new THREE.Vector3(0, -1000, 0), 
            velocity: new THREE.Vector3(),
            life: 0,
            // initialLife will be set based on glow or dissolution
            initialLife: STAR_LIGHT_PARTICLE_LIFESPAN, // Default to glow, can be overridden
            color: new THREE.Color(1, 1, 1),
            size: STAR_LIGHT_PARTICLE_SIZE,
            active: false,
        });
        const i3 = i * 3;
        positions[i3] = 0; positions[i3+1] = -1000; positions[i3+2] = 0; 
        colorsAttribute[i3] = 1; colorsAttribute[i3+1] = 1; colorsAttribute[i3+2] = 1;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));

    starEmittedParticleMaterialRef.current = new THREE.PointsMaterial({
        // Size will be set per particle if needed, or use a base size here
        size: 0.02, 
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
    });

    starEmittedParticlesRef.current = new THREE.Points(geometry, starEmittedParticleMaterialRef.current);
    starEmittedParticlesRef.current.visible = true; // Always visible, particles are managed by 'active' state
    scene.add(starEmittedParticlesRef.current);
    lastStarEmittedParticleIndexRef.current = 0;
  }, []);


  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    
    initJetParticles(scene);
    initStarEmittedParticles(scene);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initJetParticles, initStarEmittedParticles]); 


  useEffect(() => {
    if (!mountRef.current) return;

    const THREE = require('three') as typeof THREE_TYPE;
    if (!THREE) return;
    const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls.js') as { OrbitControls: typeof OrbitControlsType };

    if (!clockRef.current) { 
        clockRef.current = new THREE.Clock();
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, blackHoleRadius * 1.5, blackHoleRadius * 4);
    cameraRef.current = camera;
    if (onCameraReady) {
      onCameraReady(camera);
    }
    if (onCameraUpdateRef.current) {
       onCameraUpdateRef.current({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
    }


    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = blackHoleRadius * 1.2;
    controls.maxDistance = 500;
    controlsRef.current = controls;

    controls.addEventListener('change', () => {
      if (cameraRef.current && onCameraUpdateRef.current) {
        onCameraUpdateRef.current({ x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z });
      }
    });

    const blackHoleGeometry = new THREE.SphereGeometry(1, 64, 64);
    blackHoleMaterialRef.current = new THREE.ShaderMaterial({
      vertexShader: blackHoleVertexShader,
      fragmentShader: blackHoleFragmentShader,
      uniforms: {
        u_time: { value: 0.0 },
        u_cameraPosition: { value: camera.position }
      },
    });
    const blackHoleMesh = new THREE.Mesh(blackHoleGeometry, blackHoleMaterialRef.current);
    scene.add(blackHoleMesh);
    blackHoleRef.current = blackHoleMesh;

    createAndAddAccretionParticles(scene, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);

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
    scene.add(starsRef.current);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    if (!jetParticlesRef.current) { 
      initJetParticles(scene);
    }
    if (!starEmittedParticlesRef.current) {
      initStarEmittedParticles(scene);
    }


    const currentRendererDomElement = renderer.domElement;
    const handleCanvasShiftClick = (event: PointerEvent) => {
      if (!event.shiftKey || !cameraRef.current || !onShiftClickSpawnAtPointRef.current || !THREE) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = currentRendererDomElement.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);

      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersectionPoint = new THREE.Vector3();

      if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
        onShiftClickSpawnAtPointRef.current(intersectionPoint);
      }
    };
    currentRendererDomElement.addEventListener('pointerdown', handleCanvasShiftClick);


    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (!clockRef.current || !THREE) return; 

      const deltaTime = clockRef.current.getDelta();
      const elapsedTime = clockRef.current.getElapsedTime();

      controlsRef.current?.update();

      if (blackHoleMaterialRef.current) {
        blackHoleMaterialRef.current.uniforms.u_time.value = elapsedTime;
        if (cameraRef.current) {
            blackHoleMaterialRef.current.uniforms.u_cameraPosition.value.copy(cameraRef.current.position);
        }
      }

      if (accretionDiskRef.current?.geometry) {
        const positions = accretionDiskRef.current.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < diskParticleDataRef.current.length; i++) {
          const pData = diskParticleDataRef.current[i];
          pData.angle += pData.angularVelocity * deltaTime;
          const i3 = i * 3;
          positions[i3] = pData.radius * Math.cos(pData.angle);
          positions[i3 + 2] = pData.radius * Math.sin(pData.angle);

        }
        accretionDiskRef.current.geometry.attributes.position.needsUpdate = true;
      }
      
      spawnedPlanetsRef_anim.current.forEach(planetProp => {
        const object3D = planetMeshesRef.current.get(planetProp.id);
        let evolvingData = evolvingPlanetDataRef.current.get(planetProp.id);

        if (!object3D || !evolvingData) return; 
        
        evolvingData.angle += planetProp.angularVelocity * deltaTime;
        evolvingData.ttl -= deltaTime;
        
        let currentPlanetOrbitRadius = evolvingData.radius;
        const currentPlanetAngle = evolvingData.angle;
        const currentPlanetTimeToLive = evolvingData.ttl;
        const blackHoleActualRadius = blackHoleRadius;

        if (planetProp.isDissolving) {
            let progress = dissolvingObjectsProgressRef.current.get(planetProp.id) || 0;
            progress += deltaTime / DISSOLUTION_DURATION;
            progress = Math.min(progress, 1);
            dissolvingObjectsProgressRef.current.set(planetProp.id, progress);

            const scaleFactor = 1 - progress;
            object3D.scale.set(
                planetProp.initialScale.x * scaleFactor,
                planetProp.initialScale.y * scaleFactor,
                planetProp.initialScale.z * scaleFactor
            );
            
            currentPlanetOrbitRadius -= PULL_IN_FACTOR_DISSOLVING * blackHoleActualRadius * deltaTime * (0.5 + progress * 1.5);
            currentPlanetOrbitRadius = Math.max(currentPlanetOrbitRadius, blackHoleActualRadius * 0.05); 

            if (planetProp.type === 'star' && starEmittedParticlesRef.current && starEmittedParticleDataRef.current.length > 0 && object3D) {
                const starColor = new THREE.Color(planetProp.color);
                for (let i = 0; i < STAR_DISSOLUTION_EMIT_RATE_PER_FRAME; i++) {
                    const pIndex = lastStarEmittedParticleIndexRef.current;
                    const particle = starEmittedParticleDataRef.current[pIndex];
                    
                    if (particle && !particle.active) {
                        particle.active = true;
                        particle.position.copy(object3D.position); 
                        const randomDirection = new THREE.Vector3(
                            Math.random() - 0.5,
                            Math.random() - 0.5,
                            Math.random() - 0.5
                        ).normalize();
                        particle.velocity.copy(randomDirection).multiplyScalar(STAR_DISSOLUTION_PARTICLE_INITIAL_SPEED);
                        particle.life = 1.0; 
                        particle.initialLife = STAR_DISSOLUTION_PARTICLE_LIFESPAN + Math.random() * 0.1; // Mark as dissolution particle
                        particle.color.copy(starColor);
                        particle.size = 0.015 + Math.random() * 0.01;
                    }
                    lastStarEmittedParticleIndexRef.current = (pIndex + 1) % STAR_EMITTED_PARTICLE_COUNT;
                }
            }


            if (progress >= 1) {
                if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(planetProp.id);
                 evolvingPlanetDataRef.current.delete(planetProp.id); 
                 dissolvingObjectsProgressRef.current.delete(planetProp.id);
            }
        } else { 
            object3D.scale.set(planetProp.initialScale.x, planetProp.initialScale.y, planetProp.initialScale.z);
            if (object3D instanceof THREE.Mesh) { 
                 object3D.quaternion.slerp(new THREE.Quaternion(), 0.1); 
            }
            currentPlanetOrbitRadius -= CONTINUOUS_ORBITAL_DECAY_RATE * blackHoleActualRadius * deltaTime;

            const currentPositionVec = new THREE.Vector3(
              currentPlanetOrbitRadius * Math.cos(currentPlanetAngle),
              planetProp.yOffset,
              currentPlanetOrbitRadius * Math.sin(currentPlanetAngle)
            );
            
            if (currentPositionVec.length() < blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR) {
                if (onSetPlanetDissolvingRef.current) onSetPlanetDissolvingRef.current(planetProp.id, true);
            } else if (currentPlanetTimeToLive <= 0 || currentPositionVec.length() < blackHoleActualRadius * 0.1) { 
                if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(planetProp.id);
                evolvingPlanetDataRef.current.delete(planetProp.id); 
                dissolvingObjectsProgressRef.current.delete(planetProp.id);
            }
            currentPlanetOrbitRadius = Math.max(currentPlanetOrbitRadius, blackHoleActualRadius * 0.05); 

            // Continuous light particle emission for non-dissolving stars
            if (planetProp.type === 'star' && starEmittedParticlesRef.current && starEmittedParticleDataRef.current.length > 0 && object3D) {
                const starColor = new THREE.Color(planetProp.color);
                for (let i = 0; i < STAR_LIGHT_EMIT_RATE_PER_FRAME; i++) {
                    const pIndex = lastStarEmittedParticleIndexRef.current;
                    const particle = starEmittedParticleDataRef.current[pIndex];
                    if (particle && !particle.active) {
                        particle.active = true;
                        particle.position.copy(object3D.position);
                        const randomDirection = new THREE.Vector3(
                            Math.random() - 0.5,
                            Math.random() - 0.5,
                            Math.random() - 0.5
                        ).normalize();
                        particle.velocity.copy(randomDirection).multiplyScalar(STAR_LIGHT_PARTICLE_INITIAL_SPEED * (0.8 + Math.random() * 0.4));
                        particle.life = 1.0;
                        particle.initialLife = STAR_LIGHT_PARTICLE_LIFESPAN + Math.random() * 0.2; // Mark as light particle (longer life)
                        particle.color.copy(starColor).multiplyScalar(0.7 + Math.random() * 0.3); // Slightly vary brightness
                        particle.size = STAR_LIGHT_PARTICLE_SIZE * (0.8 + Math.random() * 0.4);
                    }
                    lastStarEmittedParticleIndexRef.current = (pIndex + 1) % STAR_EMITTED_PARTICLE_COUNT;
                }
            }
        }
        
        evolvingData.radius = currentPlanetOrbitRadius; 

        const x = currentPlanetOrbitRadius * Math.cos(currentPlanetAngle);
        const z = currentPlanetOrbitRadius * Math.sin(currentPlanetAngle);
        object3D.position.set(x, planetProp.yOffset, z);
      });

      if (starEmittedParticlesRef.current && starEmittedParticleMaterialRef.current && starEmittedParticleDataRef.current.length > 0 && THREE) {
        const positions = starEmittedParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = starEmittedParticlesRef.current.geometry.attributes.color.array as Float32Array;
        // const sizes = (starEmittedParticlesRef.current.geometry.attributes as any).size?.array as Float32Array; // If using per-particle size
        let hasActiveStarParticles = false;

        starEmittedParticleDataRef.current.forEach((p, i) => {
            if (p.active && p.life > 0) {
                hasActiveStarParticles = true;
                const forceDirection = new THREE.Vector3().subVectors(new THREE.Vector3(0,0,0), p.position);
                const distanceSq = Math.max(0.1, p.position.lengthSq()); 
                
                // Determine gravity factor based on initial life (light vs dissolution)
                // Dissolution particles have initialLife around STAR_DISSOLUTION_PARTICLE_LIFESPAN
                // Light particles have initialLife around STAR_LIGHT_PARTICLE_LIFESPAN
                const gravityFactor = p.initialLife < (STAR_DISSOLUTION_PARTICLE_LIFESPAN + STAR_LIGHT_PARTICLE_LIFESPAN) / 2 
                                      ? STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR 
                                      : STAR_LIGHT_PARTICLE_GRAVITY_FACTOR;

                forceDirection.normalize().multiplyScalar(gravityFactor / distanceSq);
                
                p.velocity.addScaledVector(forceDirection, deltaTime);
                p.position.addScaledVector(p.velocity, deltaTime);
                p.life -= deltaTime / p.initialLife; // Normalized life decrease

                const i3 = i * 3;
                positions[i3] = p.position.x;
                positions[i3 + 1] = p.position.y;
                positions[i3 + 2] = p.position.z;

                const fade = Math.max(0, p.life);
                colors[i3] = p.color.r * fade;
                colors[i3 + 1] = p.color.g * fade;
                colors[i3 + 2] = p.color.b * fade;
                // if (sizes) sizes[i] = p.size * fade;


                if (p.life <= 0 || p.position.lengthSq() < (blackHoleRadius * blackHoleRadius * 0.01) ) { // Absorb if too close to center
                    p.active = false;
                    positions[i3+1] = -1000; // Hide particle
                }
            } else if (!p.active) { 
                 const i3 = i * 3;
                 if(positions[i3+1] > -999) { 
                    positions[i3+1] = -1000; 
                    hasActiveStarParticles = true; 
                 }
            }
        });
        if(hasActiveStarParticles){
            starEmittedParticlesRef.current.geometry.attributes.position.needsUpdate = true;
            starEmittedParticlesRef.current.geometry.attributes.color.needsUpdate = true;
            // if ((starEmittedParticlesRef.current.geometry.attributes as any).size) {
            //    (starEmittedParticlesRef.current.geometry.attributes as any).size.needsUpdate = true;
            // }
        }
        starEmittedParticlesRef.current.visible = true; 
      }


        if (jetParticlesRef.current && jetMaterialRef.current && jetParticleDataRef.current.length > 0 && THREE) {
            const positions = jetParticlesRef.current.geometry.attributes.position.array as Float32Array;
            const colorsAttribute = jetParticlesRef.current.geometry.attributes.color.array as Float32Array;
            let activeJets = false;

            jetParticleDataRef.current.forEach((p, i) => {
                if (p.life > 0) {
                    p.position.addScaledVector(p.velocity, deltaTime);
                    p.life -= deltaTime / p.initialLife;

                    positions[i * 3] = p.position.x;
                    positions[i * 3 + 1] = p.position.y;
                    positions[i * 3 + 2] = p.position.z;

                    const fade = Math.max(0, p.life);
                    colorsAttribute[i * 3] = p.color.r * fade;
                    colorsAttribute[i * 3 + 1] = p.color.g * fade;
                    colorsAttribute[i * 3 + 2] = p.color.b * fade;
                    activeJets = true;
                } else if (isEmittingJets && Math.random() < 0.1) {
                    const direction = Math.random() > 0.5 ? 1 : -1;
                    p.position.set(0, direction * blackHoleRadius * 1.1, 0);

                    const spreadAngle = Math.PI / 8;
                    const coneAngle = Math.random() * Math.PI * 2;
                    const elevationAngle = (Math.random() * spreadAngle) - (spreadAngle / 2);

                    p.velocity.set(
                        Math.sin(elevationAngle) * Math.cos(coneAngle),
                        Math.cos(elevationAngle) * direction,
                        Math.sin(elevationAngle) * Math.sin(coneAngle)
                    ).normalize().multiplyScalar(JET_SPEED * (0.8 + Math.random() * 0.4));

                    p.life = 1.0;
                    p.initialLife = JET_LIFESPAN * (0.7 + Math.random() * 0.6);
                    p.color.setHSL(Math.random() * 0.1 + 0.55, 0.9, 0.7);
                    activeJets = true;
                } else {
                    positions[i * 3] = 0; positions[i * 3 + 1] = 0; positions[i * 3 + 2] = 0;
                    colorsAttribute[i * 3] = 0; colorsAttribute[i * 3 + 1] = 0; colorsAttribute[i * 3 + 2] = 0;
                }
            });
            jetParticlesRef.current.visible = activeJets || isEmittingJets;
            if (activeJets || isEmittingJets) { 
              jetParticlesRef.current.geometry.attributes.position.needsUpdate = true;
              jetParticlesRef.current.geometry.attributes.color.needsUpdate = true;
            }
        }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current) {
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (currentRendererDomElement) {
        currentRendererDomElement.removeEventListener('pointerdown', handleCanvasShiftClick);
      }
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      cancelAnimationFrame(animationFrameId);
      
      planetMeshesRef.current.forEach(object => {
        sceneRef.current?.remove(object); 
        if (object instanceof THREE.Group) { // Stars are groups
          const sphere = object.children[0] as THREE_TYPE.Mesh; // Assuming sphere is the first child
          sphere?.geometry?.dispose();
          if (sphere?.material) {
            (sphere.material as THREE_TYPE.Material).dispose();
          }
        } else if (object instanceof THREE.Mesh) { // Planets are meshes
          object.geometry?.dispose();
          if (object.material) {
             (object.material as THREE_TYPE.Material).dispose();
          }
        }
      });
      planetMeshesRef.current.clear();
      dissolvingObjectsProgressRef.current.clear();
      evolvingPlanetDataRef.current.clear();


      if (jetParticlesRef.current) {
        jetParticlesRef.current.geometry.dispose();
        if (jetParticlesRef.current.material) {
            (jetParticlesRef.current.material as THREE_TYPE.Material).dispose();
        }
      }
      if (starEmittedParticlesRef.current) {
        starEmittedParticlesRef.current.geometry.dispose();
        if (starEmittedParticlesRef.current.material) {
            (starEmittedParticlesRef.current.material as THREE_TYPE.Material).dispose();
        }
      }
      
      sceneRef.current?.traverse(object => {
        if (object !== blackHoleRef.current && object !== starsRef.current && object !== accretionDiskRef.current &&
            !(object instanceof THREE.Light) && object !== cameraRef.current &&
            !planetMeshesRef.current.has( (object as any).userData?.planetId ) && 
            !jetParticlesRef.current === object && !starEmittedParticlesRef.current === object 
            ) {
          
          if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
            object.geometry?.dispose();
            const material = object.material as THREE_TYPE.Material | THREE_TYPE.Material[];
            if (material) {
              if (Array.isArray(material)) {
                material.forEach(mat => mat.dispose());
              } else {
                material.dispose();
              }
            }
          }
        }
      });
      blackHoleRef.current?.geometry?.dispose();
      (blackHoleRef.current?.material as THREE_TYPE.Material)?.dispose();
      starsRef.current?.geometry?.dispose();
      (starsRef.current?.material as THREE_TYPE.Material)?.dispose();
      accretionDiskRef.current?.geometry?.dispose();
      (accretionDiskRef.current?.material as THREE_TYPE.Material)?.dispose();


      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      diskParticleDataRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  useEffect(() => {
    if (blackHoleRef.current) {
      blackHoleRef.current.scale.set(blackHoleRadius, blackHoleRadius, blackHoleRadius);
    }
    if (controlsRef.current) {
        controlsRef.current.minDistance = blackHoleRadius * 1.2;
    }
     if (cameraRef.current && cameraRef.current.position.length() < blackHoleRadius * 1.2) {
        const newPos = cameraRef.current.position.clone().normalize().multiplyScalar(blackHoleRadius * 1.2);
        cameraRef.current.position.copy(newPos);
        if (onCameraUpdateRef.current) {
            onCameraUpdateRef.current({x: newPos.x, y: newPos.y, z:newPos.z});
        }
    }
  }, [blackHoleRadius]);

  useEffect(() => {
    if (sceneRef.current) {
       createAndAddAccretionParticles(
        sceneRef.current,
        accretionDiskInnerRadius,
        accretionDiskOuterRadius,
        accretionDiskOpacity
      );
    }
  }, [accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity, createAndAddAccretionParticles]);


  useEffect(() => {
    const scene = sceneRef.current;
    const THREE = require('three') as typeof THREE_TYPE;
    if (!scene || !THREE) return;

    const currentPlanetObjectIds = new Set(planetMeshesRef.current.keys());
    const incomingPlanetIds = new Set(spawnedPlanets.map(p => p.id));

    spawnedPlanets.forEach(planetProp => {
      let object3D = planetMeshesRef.current.get(planetProp.id);
      if (!object3D) {
        const sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
        let sphereMaterial;
        
        if (planetProp.type === 'star') {
          const starGroup = new THREE.Group();
          sphereMaterial = new THREE.MeshBasicMaterial({ color: planetProp.color });
          const starSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
          starGroup.add(starSphere);
          // Line-based rays removed, particle system handles glow
          object3D = starGroup;

        } else { // Planet
          sphereMaterial = new THREE.MeshStandardMaterial({ color: planetProp.color, roughness: 0.5, metalness: 0.1 });
          object3D = new THREE.Mesh(sphereGeometry, sphereMaterial);
        }
        
        scene.add(object3D);
        planetMeshesRef.current.set(planetProp.id, object3D);
        (object3D as any).userData = { planetId: planetProp.id }; 
        
        evolvingPlanetDataRef.current.set(planetProp.id, {
          id: planetProp.id,
          angle: planetProp.currentAngle,
          radius: planetProp.orbitRadius,
          ttl: planetProp.timeToLive,
        });
      } else {
        // Update material/color if needed
        if (planetProp.type === 'star' && object3D instanceof THREE.Group) {
            const starSphere = object3D.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
            if (starSphere && starSphere.material instanceof THREE.MeshBasicMaterial) {
                if (starSphere.material.color.getHexString() !== new THREE.Color(planetProp.color).getHexString()){
                    starSphere.material.color.set(planetProp.color);
                }
            }
        } else if (planetProp.type === 'planet' && object3D instanceof THREE.Mesh) {
            if (object3D.material instanceof THREE.MeshStandardMaterial) {
                 if (object3D.material.color.getHexString() !== new THREE.Color(planetProp.color).getHexString()){
                    object3D.material.color.set(planetProp.color);
                }
            }
        }
      }

      object3D.scale.set(planetProp.initialScale.x, planetProp.initialScale.y, planetProp.initialScale.z);
      
      const evolvingData = evolvingPlanetDataRef.current.get(planetProp.id);
      if (evolvingData) { 
        if (planetProp.isDissolving && evolvingData.ttl !== DISSOLUTION_DURATION) {
             evolvingData.ttl = DISSOLUTION_DURATION; 
        }
      } else if (!evolvingData && object3D) { 
         evolvingPlanetDataRef.current.set(planetProp.id, {
          id: planetProp.id,
          angle: planetProp.currentAngle,
          radius: planetProp.orbitRadius,
          ttl: planetProp.timeToLive,
        });
      }
    });

    currentPlanetObjectIds.forEach(id => {
      if (!incomingPlanetIds.has(id)) {
        const object3D = planetMeshesRef.current.get(id);
        if (object3D) {
          scene.remove(object3D);
          if (object3D instanceof THREE.Group) { // Star
            const sphere = object3D.children[0] as THREE_TYPE.Mesh;
            sphere?.geometry?.dispose();
             if (sphere?.material) { (sphere.material as THREE_TYPE.Material).dispose(); }
          } else if (object3D instanceof THREE.Mesh) { // Planet
            object3D.geometry?.dispose();
             if (object3D.material) { (object3D.material as THREE_TYPE.Material).dispose(); }
          }
          planetMeshesRef.current.delete(id);
        }
        evolvingPlanetDataRef.current.delete(id);
        dissolvingObjectsProgressRef.current.delete(id);
      }
    });
  }, [spawnedPlanets]);


  return <div ref={mountRef} className="w-full h-full outline-none" data-ai-hint="galaxy space" />;
};

export default ThreeBlackholeCanvas;
    

    

