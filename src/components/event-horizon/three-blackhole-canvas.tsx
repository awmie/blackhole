
"use client";

import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlanetState } from '@/app/page';


export interface JetParticleState {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  initialLife: number;
  color: THREE.Color;
  size: number;
}


interface ThreeBlackholeCanvasProps {
  blackHoleRadius: number;
  accretionDiskInnerRadius: number;
  accretionDiskOuterRadius: number;
  accretionDiskOpacity: number;
  onCameraUpdate: (position: { x: number; y: number; z: number }) => void;
  spawnedPlanets: PlanetState[];
  onAbsorbPlanet: (id: number) => void;
  isEmittingJets: boolean;
  onCameraReady?: (camera: THREE.PerspectiveCamera) => void;
  onShiftClickSpawnAtPoint?: (position: THREE.Vector3) => void;
}

const NUM_PARTICLES = 50000;
const baseAngularSpeed = 1.0; 
const minAngularSpeedFactor = 0.02; 
const photonRingThreshold = 0.03;
const PULL_IN_FACTOR = 0.1; 

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
    float frequency = 2.0; // Base frequency
    for (int i = 0; i < 6; i++) { // 6 octaves for detail
        value += amplitude * simpleNoise(st * frequency);
        st *= 2.2; // Increase frequency for each octave (lacunarity)
        amplitude *= 0.45; // Decrease amplitude for each octave (persistence/gain)
    }
    return value;
}

void main() {
  vec3 normal = normalize(v_normal);
  vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);

  // Sharper Fresnel effect for intense edge highlighting
  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 7.0) * 3.5; // Increased power and multiplier
  fresnel = clamp(fresnel, 0.0, 1.0);

  float timeFactor = u_time * 0.07; // Base time for animation

  // More complex noise coordinates for swirling, chaotic effect
  vec2 noiseCoordBase1 = v_worldPosition.xz * 0.7 + timeFactor * 0.06;
  noiseCoordBase1.x += sin(v_worldPosition.y * 18.0 + timeFactor * 0.25) * 0.35;
  noiseCoordBase1.y += cos(v_worldPosition.x * 15.0 - timeFactor * 0.21) * 0.3;

  vec2 noiseCoordBase2 = v_worldPosition.yx * 1.2 - timeFactor * 0.04;
  noiseCoordBase2.y += cos(v_worldPosition.z * 14.0 - timeFactor * 0.18) * 0.3;
  noiseCoordBase2.x += sin(v_worldPosition.z * 16.0 + timeFactor * 0.28) * 0.25;

  // Generate noise values using fbm
  float noiseVal1 = fbm(noiseCoordBase1);
  float noiseVal2 = fbm(noiseCoordBase2 * 1.4 + vec2(sin(timeFactor*0.12), cos(timeFactor*0.12)) * 0.6);

  // Combine noise, make it more prominent at edges
  float radialDistFactor = smoothstep(0.8, 1.0, length(v_worldPosition.xy / length(vec2(1.0,1.0)))); // Normalize based on unit sphere
  float combinedNoise = (noiseVal1 * 0.6 + noiseVal2 * 0.4) * (0.3 + radialDistFactor * 0.7);
  combinedNoise = smoothstep(0.3, 0.7, combinedNoise); // Remap noise to a nicer range

  // Define colors
  vec3 coreColor = vec3(0.0, 0.0, 0.0); // Black core
  vec3 lensedLightColor = vec3(1.0, 0.75, 0.9); // Bright, accretion-disk inspired pinkish-white

  // Modulate lensed light by Fresnel and noise, ensuring high intensity at edges
  float effectIntensity = fresnel * combinedNoise * 2.5; // Increased intensity multiplier
  
  // Mix core black with lensed light
  vec3 finalColor = mix(coreColor, lensedLightColor, clamp(effectIntensity, 0.0, 1.0));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const JET_PARTICLE_COUNT = 2000;
const JET_LIFESPAN = 2;
const JET_SPEED = 5;


const ThreeBlackholeCanvas: React.FC<ThreeBlackholeCanvasProps> = ({
  blackHoleRadius,
  accretionDiskInnerRadius,
  accretionDiskOuterRadius,
  accretionDiskOpacity,
  onCameraUpdate,
  spawnedPlanets,
  onAbsorbPlanet,
  isEmittingJets,
  onCameraReady,
  onShiftClickSpawnAtPoint,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const blackHoleRef = useRef<THREE.Mesh | null>(null);
  const blackHoleMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const accretionDiskRef = useRef<THREE.Points | null>(null);
  const starsRef = useRef<THREE.Points | null>(null);

  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const diskParticleDataRef = useRef<DiskParticleData[]>([]);
  const planetMeshesRef = useRef<Map<number, THREE.Mesh>>(new Map());

  const jetParticlesRef = useRef<THREE.Points | null>(null);
  const jetParticleDataRef = useRef<JetParticleState[]>([]);
  const jetMaterialRef = useRef<THREE.PointsMaterial | null>(null);

  const onShiftClickSpawnAtPointRef = useRef(onShiftClickSpawnAtPoint);
  const onCameraUpdateRef = useRef(onCameraUpdate);
  const spawnedPlanetsRef = useRef(spawnedPlanets);

  useEffect(() => {
    spawnedPlanetsRef.current = spawnedPlanets;
  }, [spawnedPlanets]);

  useEffect(() => {
    onShiftClickSpawnAtPointRef.current = onShiftClickSpawnAtPoint;
  }, [onShiftClickSpawnAtPoint]);

  useEffect(() => {
    onCameraUpdateRef.current = onCameraUpdate;
  }, [onCameraUpdate]);


  const createAndAddAccretionParticles = useCallback((
    scene: THREE.Scene,
    innerR: number,
    outerR: number,
    opacity: number
  ) => {
    if (accretionDiskRef.current) {
      scene.remove(accretionDiskRef.current);
      accretionDiskRef.current.geometry.dispose();
      (accretionDiskRef.current.material as THREE.Material).dispose();
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

  const initJetParticles = useCallback((scene: THREE.Scene) => {
    if (jetParticlesRef.current) {
        scene.remove(jetParticlesRef.current);
        jetParticlesRef.current.geometry.dispose();
        (jetParticlesRef.current.material as THREE.Material).dispose();
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


  useEffect(() => {
    if (!mountRef.current || !rendererRef.current) return; 

    const scene = sceneRef.current;
    if (!scene) return; 

    initJetParticles(scene);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef.current]); 


  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    clockRef.current = new THREE.Clock();

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

    initJetParticles(scene);

    const currentRendererDomElement = renderer.domElement;
    const handleCanvasShiftClick = (event: PointerEvent) => {
      if (!event.shiftKey || !cameraRef.current || !onShiftClickSpawnAtPointRef.current) return;

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
      const deltaTime = clockRef.current.getDelta();
      const elapsedTime = clockRef.current.getElapsedTime();

      controls.update();

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


      const planetMeshes = planetMeshesRef.current;
      spawnedPlanetsRef.current.forEach(planet => {
        const mesh = planetMeshes.get(planet.id);
        if (!mesh) return;

        planet.currentAngle += planet.angularVelocity * deltaTime;
        planet.timeToLive -= deltaTime;

        let currentOrbitRadius = planet.orbitRadius;

        if (planet.isStretching || planet.timeToLive < 10) { 
            currentOrbitRadius -= PULL_IN_FACTOR * blackHoleRadius * deltaTime * (10 / Math.max(1, planet.timeToLive));
            currentOrbitRadius = Math.max(currentOrbitRadius, blackHoleRadius * 0.5); 
            planet.orbitRadius = currentOrbitRadius; 
        }


        const x = currentOrbitRadius * Math.cos(planet.currentAngle);
        const z = currentOrbitRadius * Math.sin(planet.currentAngle);
        mesh.position.set(x, planet.yOffset, z);

        const distanceToCenterSq = x*x + planet.yOffset*planet.yOffset + z*z; 
        const blackHoleRadiusSq = blackHoleRadius * blackHoleRadius;

        if (distanceToCenterSq < blackHoleRadiusSq * 1.5 * 1.5 && !planet.isStretching) { 
            planet.isStretching = true;
            const radialDir = new THREE.Vector3(x, planet.yOffset, z).normalize();
            planet.stretchAxis = {x: -radialDir.x, y: -radialDir.y, z: -radialDir.z };
        }

        if (planet.isStretching) {
            const stretchFactor = Math.min(5, 1 + (blackHoleRadiusSq / Math.max(distanceToCenterSq, 0.01)) * 2); 
            const squashFactor = 1 / Math.sqrt(stretchFactor); 

            mesh.scale.set(
                planet.initialScale.x * squashFactor,
                planet.initialScale.y * squashFactor,
                planet.initialScale.z * squashFactor
            );

            let targetDir = mesh.position.clone().normalize().multiplyScalar(-1); 
            if (Math.abs(planet.stretchAxis.x) + Math.abs(planet.stretchAxis.y) + Math.abs(planet.stretchAxis.z) > 0.1) {
                const stretchDir = new THREE.Vector3(planet.stretchAxis.x, planet.stretchAxis.y, planet.stretchAxis.z).normalize();
                targetDir = stretchDir; 
            }


            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), targetDir); 
            mesh.quaternion.slerp(quaternion, 0.1); 

            mesh.scale.z *= stretchFactor / squashFactor; 


        } else {
            mesh.scale.set(planet.currentScale.x, planet.currentScale.y, planet.currentScale.z);
        }


        if (distanceToCenterSq < blackHoleRadiusSq * 0.8 || planet.timeToLive <= 0) { 
          onAbsorbPlanet(planet.id);
        }
      });


        if (jetParticlesRef.current && jetMaterialRef.current && jetParticleDataRef.current.length > 0) {
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
            jetParticlesRef.current.geometry.attributes.position.needsUpdate = true;
            jetParticlesRef.current.geometry.attributes.color.needsUpdate = true;
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
      cancelAnimationFrame(animationFrameId);
      planetMeshesRef.current.forEach(mesh => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        scene.remove(mesh);
      });
      planetMeshesRef.current.clear();

      if (jetParticlesRef.current) {
        scene.remove(jetParticlesRef.current);
        jetParticlesRef.current.geometry.dispose();
        (jetParticlesRef.current.material as THREE.Material).dispose();
      }

      sceneRef.current?.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry?.dispose();
           if (Array.isArray(object.material)) {
            object.material.forEach(mat => mat.dispose());
          } else if (object.material) {
            (object.material as THREE.Material).dispose();
          }
        }
      });
      if (mountRef.current && rendererRef.current) { 
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      diskParticleDataRef.current = []; 
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAndAddAccretionParticles, initJetParticles, onCameraReady]); 

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accretionDiskInnerRadius, accretionDiskOuterRadius, createAndAddAccretionParticles]); 

  useEffect(() => {
    if (accretionDiskRef.current?.material) { 
       if (sceneRef.current) { 
            createAndAddAccretionParticles(sceneRef.current, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
       }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accretionDiskOpacity, createAndAddAccretionParticles]); 

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentMeshIds = Array.from(planetMeshesRef.current.keys());
    const planetIds = spawnedPlanets.map(p => p.id);

    spawnedPlanets.forEach(planet => {
      if (!planetMeshesRef.current.has(planet.id)) {
        const geometry = new THREE.SphereGeometry(1, 16, 16); 
        let material;
        if (planet.type === 'star') {
          material = new THREE.MeshBasicMaterial({ color: planet.color });
        } else {
          material = new THREE.MeshStandardMaterial({ color: planet.color, roughness: 0.5, metalness: 0.1 });
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(planet.initialScale.x, planet.initialScale.y, planet.initialScale.z);
        scene.add(mesh);
        planetMeshesRef.current.set(planet.id, mesh);
      } else {
        const mesh = planetMeshesRef.current.get(planet.id);
        if (mesh) {
          const expectedMaterialType = planet.type === 'star' ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
          if (!(mesh.material instanceof expectedMaterialType)) {
             (mesh.material as THREE.Material).dispose();
             if (planet.type === 'star') {
                mesh.material = new THREE.MeshBasicMaterial({ color: planet.color });
             } else {
                mesh.material = new THREE.MeshStandardMaterial({ color: planet.color, roughness: 0.5, metalness: 0.1 });
             }
          } else {
            if ((mesh.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial).color.getHexString() !== planet.color.substring(1)) { 
                (mesh.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial).color.set(planet.color);
            }
          }
        }
      }
    });

    currentMeshIds.forEach(id => {
      if (!planetIds.includes(id)) {
        const mesh = planetMeshesRef.current.get(id);
        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          planetMeshesRef.current.delete(id);
        }
      }
    });
  }, [spawnedPlanets]);


  return <div ref={mountRef} className="w-full h-full outline-none" data-ai-hint="galaxy space" />;
};

export default ThreeBlackholeCanvas;

