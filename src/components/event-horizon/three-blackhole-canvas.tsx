
"use client";

import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PlanetState {
  id: number;
  orbitRadius: number;
  currentAngle: number;
  angularVelocity: number;
  yOffset: number;
  color: string;
  initialScale: { x: number; y: number; z: number };
  currentScale: { x: number; y: number; z: number };
  timeToLive: number; // in seconds
  isStretching: boolean;
  stretchAxis: { x: number; y: number; z: number }; // Normalized vector
  progressValue: number; // Generic value for animations/state
}

export interface JetParticleState {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number; // 0 to 1, 1 is full life
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
}

const NUM_PARTICLES = 50000;
const baseAngularSpeed = 1.0; 
const minAngularSpeedFactor = 0.02;
const photonRingThreshold = 0.03; 

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
    for (int i = 0; i < 5; i++) {
        value += amplitude * simpleNoise(st);
        st *= 2.1; 
        amplitude *= 0.45;
    }
    return value;
}

void main() {
  vec3 normal = normalize(v_normal);
  vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);

  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 6.0) * 2.5; 
  fresnel = clamp(fresnel, 0.0, 1.0);

  vec2 noiseCoordBase1 = v_worldPosition.xz * 1.0 + u_time * 0.06;
  noiseCoordBase1.x += sin(v_worldPosition.y * 10.0 + u_time * 0.15) * 0.25; 
  
  vec2 noiseCoordBase2 = v_worldPosition.yx * 1.2 - u_time * 0.04; 
  noiseCoordBase2.y += cos(v_worldPosition.z * 8.0 - u_time * 0.12) * 0.2;

  float noiseVal1 = fbm(noiseCoordBase1);
  float noiseVal2 = fbm(noiseCoordBase2 * 1.5); 

  float combinedNoise = noiseVal1 * 0.6 + noiseVal2 * 0.4; 
  combinedNoise = smoothstep(0.35, 0.65, combinedNoise); 

  vec3 color = vec3(0.0, 0.0, 0.0);
  vec3 lensedLightColor = vec3(1.0, 0.75, 0.95); 
  float effectIntensity = fresnel * combinedNoise * 2.0; 
  
  color = mix(color, lensedLightColor, clamp(effectIntensity, 0.0, 1.0)); 

  gl_FragColor = vec4(color, 1.0);
}
`;

const JET_PARTICLE_COUNT = 2000;
const JET_LIFESPAN = 2; // seconds
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
      const yOffset = (Math.random() - 0.5) * 0.15; 

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
        photonRingIntensity = Math.pow(photonRingIntensity, 2.0); 
        particleColor.lerp(colorPhotonRing, photonRingIntensity * 0.8); 
        particleColor.r = Math.min(1.0, particleColor.r + photonRingIntensity * 2.0); 
        particleColor.g = Math.min(1.0, particleColor.g + photonRingIntensity * 2.0);
        particleColor.b = Math.min(1.0, particleColor.b + photonRingIntensity * 2.0);
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

      let particleAlpha = opacity; // Use global opacity as base
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
      // opacity: opacity, // Opacity now controlled by vertex alpha * global opacity
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
    const colors = new Float32Array(JET_PARTICLE_COUNT * 3); // RGB

    jetParticleDataRef.current = [];
    for (let i = 0; i < JET_PARTICLE_COUNT; i++) {
        const life = 0; // Start dead
        const initialLife = JET_LIFESPAN * (0.5 + Math.random() * 0.5); // Randomized lifespan
        
        jetParticleDataRef.current.push({
            id: i,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            life,
            initialLife,
            color: new THREE.Color(1,1,1), // Start white, maybe change later
            size: 0.02 + Math.random() * 0.03,
        });
        positions[i*3] = 0;
        positions[i*3+1] = 0;
        positions[i*3+2] = 0;
        colors[i*3] = 1;
        colors[i*3+1] = 1;
        colors[i*3+2] = 1;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    jetMaterialRef.current = new THREE.PointsMaterial({
        size: 0.05, // Will be set per particle later or use sizeAttenuation
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
    });

    jetParticlesRef.current = new THREE.Points(geometry, jetMaterialRef.current);
    jetParticlesRef.current.visible = false; // Start hidden
    scene.add(jetParticlesRef.current);
  }, []);


  useEffect(() => {
    if (!mountRef.current || !rendererRef.current) return; // Ensure renderer is set up

    const scene = sceneRef.current;
    if (!scene) return;

    initJetParticles(scene);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef.current]); // Depend on renderer being ready


  // Main setup effect
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
    onCameraUpdate({ x: camera.position.x, y: camera.position.y, z: camera.position.z });

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
      if (cameraRef.current) {
        onCameraUpdate({ x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z });
      }
    });

    const blackHoleGeometry = new THREE.SphereGeometry(1, 64, 64); // Radius will be set by scale
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
    for (let i = 0; i < 100000; i++) { 
        const r = 200 + Math.random() * 600; 
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * Math.PI;
        starVertices.push(r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(theta));
    }
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true }); 
    starsRef.current = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starsRef.current);

    initJetParticles(scene);


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

      // Planets animation
      const planetMeshes = planetMeshesRef.current;
      spawnedPlanets.forEach(planet => {
        const mesh = planetMeshes.get(planet.id);
        if (!mesh) return;

        planet.currentAngle += planet.angularVelocity * deltaTime;
        planet.timeToLive -= deltaTime;

        let currentOrbitRadius = planet.orbitRadius;
        
        // Simple inward spiral based on timeToLive or if stretching
        const pullInFactor = 0.05; // How fast it spirals in when stretching
        if (planet.isStretching || planet.timeToLive < 10) { // Start pulling in if stretching or near end of life
            currentOrbitRadius -= pullInFactor * blackHoleRadius * deltaTime * (10 / Math.max(1, planet.timeToLive));
            currentOrbitRadius = Math.max(currentOrbitRadius, blackHoleRadius * 0.5); // Don't go too deep too fast before absorption
        }


        const x = currentOrbitRadius * Math.cos(planet.currentAngle);
        const z = currentOrbitRadius * Math.sin(planet.currentAngle);
        mesh.position.set(x, planet.yOffset, z);
        
        const distanceToCenterSq = x*x + planet.yOffset*planet.yOffset + z*z;
        const blackHoleRadiusSq = blackHoleRadius * blackHoleRadius;

        if (distanceToCenterSq < blackHoleRadiusSq * 1.5 * 1.5 && !planet.isStretching) { // Start stretching a bit further out
            planet.isStretching = true;
            // Orient stretch axis towards black hole (simplified: radial)
            const radialDir = new THREE.Vector3(x, planet.yOffset, z).normalize();
            planet.stretchAxis = {x: radialDir.x, y: radialDir.y, z: radialDir.z };
        }
        
        if (planet.isStretching) {
            const stretchAmount = Math.min(5, 1 + (blackHoleRadiusSq / Math.max(distanceToCenterSq, 0.01)) * 2); // More stretch closer
            const squashAmount = 1 / Math.sqrt(stretchAmount); // Conserve volume roughly

            // Apply stretch based on planet.stretchAxis relative to object's local axes
            // This is simplified. True spaghettification aligns with tidal forces.
            // For a sphere, we can align one local axis with stretchAxis and scale.
            // Here, we just scale world axes, assuming planet isn't rotating itself much.
             mesh.scale.set(
                planet.initialScale.x * (Math.abs(planet.stretchAxis.x) > 0.5 ? stretchAmount : squashAmount),
                planet.initialScale.y * (Math.abs(planet.stretchAxis.y) > 0.5 ? stretchAmount : squashAmount),
                planet.initialScale.z * (Math.abs(planet.stretchAxis.z) > 0.5 ? stretchAmount : squashAmount)
            );

        } else {
            mesh.scale.set(planet.currentScale.x, planet.currentScale.y, planet.currentScale.z);
        }


        if (distanceToCenterSq < blackHoleRadiusSq * 0.8 || planet.timeToLive <= 0) { // Absorb if very close or TTL expired
          onAbsorbPlanet(planet.id);
        }
      });

      // Jet animation
        if (jetParticlesRef.current && jetMaterialRef.current && jetParticleDataRef.current.length > 0) {
            const positions = jetParticlesRef.current.geometry.attributes.position.array as Float32Array;
            const colors = jetParticlesRef.current.geometry.attributes.color.array as Float32Array;
            let activeJets = false;

            jetParticleDataRef.current.forEach((p, i) => {
                if (p.life > 0) {
                    p.position.addScaledVector(p.velocity, deltaTime);
                    p.life -= deltaTime / p.initialLife;
                    
                    positions[i * 3] = p.position.x;
                    positions[i * 3 + 1] = p.position.y;
                    positions[i * 3 + 2] = p.position.z;

                    const fade = Math.max(0, p.life); // Fade out
                    colors[i * 3] = p.color.r * fade;
                    colors[i * 3 + 1] = p.color.g * fade;
                    colors[i * 3 + 2] = p.color.b * fade;
                    activeJets = true;
                } else if (isEmittingJets && Math.random() < 0.1) { // Chance to revive a particle if jets active
                    const direction = Math.random() > 0.5 ? 1 : -1; // Top or bottom jet
                    p.position.set(0, direction * blackHoleRadius * 1.1, 0); // Start near pole
                    
                    // Velocity outwards along Y, with some spread
                    const spreadAngle = Math.PI / 8; // Cone angle for jet
                    const randomAngle = Math.random() * spreadAngle - spreadAngle / 2;
                    const randomDirection = new THREE.Vector3(Math.sin(randomAngle), direction, Math.cos(randomAngle)).normalize();
                    
                    p.velocity.copy(randomDirection).multiplyScalar(JET_SPEED * (0.8 + Math.random() * 0.4));
                    p.life = 1.0;
                    p.initialLife = JET_LIFESPAN * (0.7 + Math.random() * 0.6);
                    p.color.setHSL(Math.random() * 0.1 + 0.55, 0.9, 0.7); // Bluish-white
                    activeJets = true;
                } else {
                    // Keep dead particles off-screen or at origin with zero alpha
                    positions[i * 3] = 0; positions[i * 3 + 1] = 0; positions[i * 3 + 2] = 0;
                    colors[i * 3] = 0; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
                }
            });
            jetParticlesRef.current.visible = activeJets || isEmittingJets; // Show if jets are active or should be emitting
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
  }, []); 

  // Black hole radius update
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
        onCameraUpdate({x: newPos.x, y: newPos.y, z:newPos.z});
    }
  }, [blackHoleRadius, onCameraUpdate]);

  // Accretion disk parameters update
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

  // Accretion disk opacity update
  useEffect(() => {
    if (accretionDiskRef.current?.material) {
      // Opacity is now controlled by vertex alpha, but we can update the base color alphas if needed or a global multiplier
      // For now, assuming vertex alpha driven by createAndAddAccretionParticles handles it along with the base opacity prop.
      // If we need to re-generate colors/alphas on global opacity change:
       if (sceneRef.current) {
            createAndAddAccretionParticles(sceneRef.current, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
       }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accretionDiskOpacity, createAndAddAccretionParticles]);

  // Planet meshes management
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentMeshIds = Array.from(planetMeshesRef.current.keys());
    const planetIds = spawnedPlanets.map(p => p.id);

    // Add new planet meshes
    spawnedPlanets.forEach(planet => {
      if (!planetMeshesRef.current.has(planet.id)) {
        const geometry = new THREE.SphereGeometry(0.5, 16, 16); // Base size 0.5, scaled by planet.initialScale
        const material = new THREE.MeshStandardMaterial({ color: planet.color, roughness: 0.5, metalness: 0.1 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(planet.initialScale.x, planet.initialScale.y, planet.initialScale.z);
        scene.add(mesh);
        planetMeshesRef.current.set(planet.id, mesh);
      } else {
        // Update existing mesh properties if needed (e.g. color, though not changing here)
        const mesh = planetMeshesRef.current.get(planet.id);
        if (mesh) {
            // mesh.scale.set(planet.currentScale.x, planet.currentScale.y, planet.currentScale.z);
            // Color update example:
            // if ((mesh.material as THREE.MeshStandardMaterial).color.getHexString() !== planet.color.substring(1)) {
            //     (mesh.material as THREE.MeshStandardMaterial).color.set(planet.color);
            // }
        }
      }
    });

    // Remove old planet meshes
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
