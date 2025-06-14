
"use client";

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface ThreeBlackholeCanvasProps {
  blackHoleRadius: number;
  accretionDiskInnerRadius: number;
  accretionDiskOuterRadius: number;
  accretionDiskOpacity: number;
  onCameraUpdate: (position: { x: number; y: number; z: number }) => void;
}

const NUM_PARTICLES = 50000; // Number of particles in the accretion disk

interface ParticleData {
  radius: number;
  angle: number;
  angularVelocity: number;
  yOffset: number;
}

// Vertex Shader for the Black Hole
const blackHoleVertexShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
// cameraPosition is a built-in uniform from Three.js

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  v_worldPosition = worldPos.xyz;
  v_normal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fragment Shader for the Black Hole
const blackHoleFragmentShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
uniform float u_time;
uniform vec3 u_cameraPosition; // Explicitly declare if cameraPosition built-in is problematic

// Simple procedural noise function (hash)
float simpleNoise(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
  vec3 normal = normalize(v_normal);
  // Use u_cameraPosition if built-in cameraPosition is not working as expected in varying
  // For now, assuming cameraPosition (built-in) can be used directly or passed if needed.
  // If using an explicit uniform: vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);
  vec3 viewDir = normalize(cameraPosition - v_worldPosition);


  // Fresnel effect: stronger at glancing angles (edges of the sphere)
  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 3.0); // Power controls sharpness of edge

  // Animated procedural noise for distortion effect
  vec2 noiseCoordBase = v_worldPosition.xy * 0.4 + u_time * 0.03;
  float noiseVal = simpleNoise(noiseCoordBase + simpleNoise(noiseCoordBase * 1.5 + u_time * 0.015)); // Layered noise
  noiseVal = smoothstep(0.25, 0.75, noiseVal); // Smooth the noise

  // Base color is black
  vec3 color = vec3(0.0, 0.0, 0.0);

  // Lensed light color (e.g., a dim, desaturated blue/purple or whitish)
  vec3 lensedLightColor = vec3(0.3, 0.3, 0.6); 
  
  // Mix the black color with the lensed light color based on fresnel and noise
  // This effect should be subtle and mostly at the edges.
  color = mix(color, lensedLightColor, fresnel * noiseVal * 0.4); 

  gl_FragColor = vec4(color, 1.0);
}
`;


const ThreeBlackholeCanvas: React.FC<ThreeBlackholeCanvasProps> = ({
  blackHoleRadius,
  accretionDiskInnerRadius,
  accretionDiskOuterRadius,
  accretionDiskOpacity,
  onCameraUpdate,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const blackHoleRef = useRef<THREE.Mesh | null>(null);
  const accretionDiskRef = useRef<THREE.Points | null>(null);
  const starsRef = useRef<THREE.Points | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const particleDataRef = useRef<ParticleData[]>([]);

  const createAndAddAccretionParticles = (
    scene: THREE.Scene,
    innerR: number,
    outerR: number,
    opacity: number
  ) => {
    if (accretionDiskRef.current) {
      scene.remove(accretionDiskRef.current);
      accretionDiskRef.current.geometry.dispose();
      if (Array.isArray(accretionDiskRef.current.material)) {
        accretionDiskRef.current.material.forEach(m => m.dispose());
      } else {
        (accretionDiskRef.current.material as THREE.Material).dispose();
      }
      accretionDiskRef.current = null;
    }

    const particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_PARTICLES * 3);
    const colors = new Float32Array(NUM_PARTICLES * 4); 
    particleDataRef.current = [];

    const colorInner = new THREE.Color(1.0, 0.4, 0.8); 
    const colorMid = new THREE.Color(0.6, 0.3, 0.9);   
    const colorOuter = new THREE.Color(0.2, 0.1, 0.7); 
    const colorPhotonRing = new THREE.Color(1.0, 0.95, 0.85); 

    const baseAngularSpeed = 0.4; 
    const minAngularSpeedFactor = 0.05; 
    const outerFadeStartNormalized = 0.7; 

    for (let i = 0; i < NUM_PARTICLES; i++) {
      const i3 = i * 3;
      const i4 = i * 4; 
      const radius = Math.random() * (outerR - innerR) + innerR;
      const angle = Math.random() * Math.PI * 2;
      const yOffset = (Math.random() - 0.5) * 0.15;

      let normalizedDist = (radius - innerR) / (outerR - innerR);
      normalizedDist = Math.max(0, Math.min(1, normalizedDist));

      const keplerianFactor = Math.pow(innerR / radius, 2.0);
      let angularVelocity = baseAngularSpeed * keplerianFactor;

      const photonRingThreshold = 0.03;
      if (normalizedDist < photonRingThreshold) {
        angularVelocity *= 5.0;
      }
      
      angularVelocity = Math.max(angularVelocity, baseAngularSpeed * minAngularSpeedFactor);

      particleDataRef.current.push({ radius, angle, angularVelocity, yOffset });

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
        particleColor.r += particleColor.r * photonRingIntensity * 2.0; 
        particleColor.g += particleColor.g * photonRingIntensity * 2.0;
        particleColor.b += particleColor.b * photonRingIntensity * 2.0;
      } else {
        const innerEdgeFactor = 1.0 - Math.min(1.0, Math.max(0.0, (normalizedDist - photonRingThreshold) / 0.15));
         if (innerEdgeFactor > 0) {
            particleColor.r += particleColor.r * innerEdgeFactor * 0.8;
            particleColor.g += particleColor.g * innerEdgeFactor * 0.8;
            particleColor.b += particleColor.b * innerEdgeFactor * 0.8;
        }
      }

      particleColor.r = Math.min(1.0, Math.max(0.0, particleColor.r));
      particleColor.g = Math.min(1.0, Math.max(0.0, particleColor.g));
      particleColor.b = Math.min(1.0, Math.max(0.0, particleColor.b));

      colors[i4] = particleColor.r;
      colors[i4 + 1] = particleColor.g;
      colors[i4 + 2] = particleColor.b;

      let particleAlpha = 1.0;
      if (normalizedDist > outerFadeStartNormalized) {
        particleAlpha = 1.0 - (normalizedDist - outerFadeStartNormalized) / (1.0 - outerFadeStartNormalized);
      }
      particleAlpha = Math.max(0.0, Math.min(1.0, particleAlpha)); 
      colors[i4 + 3] = particleAlpha;
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.01, 
      vertexColors: true,
      transparent: true,
      opacity: opacity, 
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const newDisk = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(newDisk);
    accretionDiskRef.current = newDisk;
  };


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
    camera.position.set(0, blackHoleRadius * 2, blackHoleRadius * 5);
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
    controls.minDistance = blackHoleRadius * 1.5;
    controls.maxDistance = 500;
    controlsRef.current = controls;
    
    controls.addEventListener('change', () => {
      if (cameraRef.current) {
        onCameraUpdate({ x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z });
      }
    });

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
    scene.add(ambientLight);

    const blackHoleGeometry = new THREE.SphereGeometry(blackHoleRadius, 64, 64);
    const blackHoleMaterial = new THREE.ShaderMaterial({
      vertexShader: blackHoleVertexShader,
      fragmentShader: blackHoleFragmentShader,
      uniforms: {
        u_time: { value: 0.0 },
        // u_cameraPosition: { value: camera.position } // Pass camera position if needed explicitly
      },
      transparent: false, // Black hole is opaque
    });
    const blackHole = new THREE.Mesh(blackHoleGeometry, blackHoleMaterial);
    scene.add(blackHole);
    blackHoleRef.current = blackHole;

    createAndAddAccretionParticles(scene, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
    
    const starsGeometry = new THREE.BufferGeometry();
    const starVertices = [];
    for (let i = 0; i < 60000; i++) { 
        const r = 100 + Math.random() * 400; 
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * Math.PI;
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.sin(theta) * Math.sin(phi);
        const z = r * Math.cos(theta);
        starVertices.push(x, y, z);
    }
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true }); 
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);
    starsRef.current = stars;

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      const deltaTime = clockRef.current.getDelta();
      const elapsedTime = clockRef.current.getElapsedTime();

      if (blackHoleRef.current && blackHoleRef.current.material instanceof THREE.ShaderMaterial) {
        blackHoleRef.current.material.uniforms.u_time.value = elapsedTime;
        // If u_cameraPosition uniform is used:
        // if (cameraRef.current) {
        //   blackHoleRef.current.material.uniforms.u_cameraPosition.value.copy(cameraRef.current.position);
        // }
      }

      if (accretionDiskRef.current && accretionDiskRef.current.geometry) {
        const positions = accretionDiskRef.current.geometry.attributes.position.array as Float32Array;
        const particleData = particleDataRef.current;

        for (let i = 0; i < particleData.length; i++) {
          const pData = particleData[i];
          pData.angle += pData.angularVelocity * deltaTime;

          const i3 = i * 3;
          positions[i3] = pData.radius * Math.cos(pData.angle);
          positions[i3 + 2] = pData.radius * Math.sin(pData.angle);
        }
        accretionDiskRef.current.geometry.attributes.position.needsUpdate = true;
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
      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      sceneRef.current?.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry?.dispose();
           if (Array.isArray(object.material)) {
            object.material.forEach(mat => mat.dispose());
          } else {
            (object.material as THREE.Material)?.dispose();
          }
        }
      });
      if (accretionDiskRef.current) { 
         accretionDiskRef.current.geometry?.dispose();
         if (Array.isArray(accretionDiskRef.current.material)) {
            accretionDiskRef.current.material.forEach(m => m.dispose());
         } else {
            (accretionDiskRef.current.material as THREE.Material)?.dispose();
         }
      }
      controlsRef.current?.dispose();
      particleDataRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  useEffect(() => {
    if (blackHoleRef.current) {
      blackHoleRef.current.geometry.dispose(); 
      blackHoleRef.current.geometry = new THREE.SphereGeometry(blackHoleRadius, 64, 64);
    }
    if (controlsRef.current) {
        controlsRef.current.minDistance = blackHoleRadius * 1.5;
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
  }, [accretionDiskInnerRadius, accretionDiskOuterRadius]); 

  useEffect(() => {
    if (accretionDiskRef.current && accretionDiskRef.current.material instanceof THREE.PointsMaterial) {
      accretionDiskRef.current.material.opacity = accretionDiskOpacity;
    }
  }, [accretionDiskOpacity]);


  return <div ref={mountRef} className="w-full h-full outline-none" data-ai-hint="galaxy space" />;
};

export default ThreeBlackholeCanvas;
