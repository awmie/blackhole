
"use client";

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface ThreeBlackholeCanvasProps {
  blackHoleRadius: number;
  accretionDiskInnerRadius: number;
  accretionDiskOuterRadius: number;
  accretionDiskOpacity: number;
  onCameraUpdate: (position: { x: number; y: number; z: number }) => void;
}

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uBlackHoleRadius;
  uniform float uAccretionDiskInnerRadius;
  uniform float uAccretionDiskOuterRadius;
  uniform float uAccretionDiskOpacity;

  varying vec2 vUv; // vUv.x is angle (0 to 1), vUv.y is radial (0 inner, 1 outer)
  varying vec3 vWorldPosition;

  const float PI = 3.14159265359;

  // Simple 2D noise function
  float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Value noise
  float noise(vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);
      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
  }

  // Fractional Brownian Motion
  float fbm(vec2 st) {
      float value = 0.0;
      float amplitude = 0.5;
      // float frequency = 0.0; // Original, unused
      for (int i = 0; i < 4; i++) {
          value += amplitude * noise(st);
          st *= 2.0;
          amplitude *= 0.5;
      }
      return value;
  }

  void main() {
      float normalizedDist = vUv.y; // 0 for inner radius, 1 for outer radius

      // Base colors
      vec3 colorInner = vec3(1.0, 0.4, 0.8); // Pinkish/Magenta
      vec3 colorMid = vec3(0.6, 0.3, 0.9);   // Purple
      vec3 colorOuter = vec3(0.2, 0.1, 0.7); // Darker Blue/Purple
      
      vec3 baseColor;
      if (normalizedDist < 0.5) {
        baseColor = mix(colorInner, colorMid, normalizedDist * 2.0);
      } else {
        baseColor = mix(colorMid, colorOuter, (normalizedDist - 0.5) * 2.0);
      }

      // Add swirling pattern
      // Using vUv.x (angle) and vUv.y (radial) for texture coordinates.
      float swirlPattern = fbm(vec2(vUv.y * 6.0 + vUv.x * 3.0 , vUv.x * 6.0 + uTime * 0.3 + vUv.y * 2.0));
      swirlPattern = smoothstep(0.35, 0.65, swirlPattern); // Increase contrast

      vec3 finalColor = baseColor * (0.6 + swirlPattern * 0.7); // Modulate base color with pattern

      // Make inner edge brighter (emissive-like)
      float innerEdgeFactor = 1.0 - smoothstep(0.0, 0.2, normalizedDist); // Broader bright inner region
      finalColor += baseColor * innerEdgeFactor * 0.8; // Additive brightness for inner edge

      // Photon sphere visual cue: a very bright band at the innermost edge
      float photonRingIntensity = 0.0;
      if (normalizedDist < 0.03) { // Very close to the inner edge (e.g. first 3%)
          photonRingIntensity = (0.03 - normalizedDist) / 0.03; 
          photonRingIntensity = pow(photonRingIntensity, 2.0); // Sharpen the peak
      }
      
      finalColor += vec3(1.0, 0.95, 0.85) * photonRingIntensity * 2.0; // Additive bright, slightly yellowish-white light

      gl_FragColor = vec4(finalColor, uAccretionDiskOpacity);
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
  const accretionDiskRef = useRef<THREE.Mesh | null>(null);
  const starsRef = useRef<THREE.Points | null>(null);

  // Effect for initializing and cleaning up Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

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

    // Ambient light (reduced, as disk is now emissive)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    scene.add(ambientLight);
    // Point light (can be removed or reduced if disk is fully emissive)
    // const pointLight = new THREE.PointLight(0xffffff, 0.5, 100);
    // pointLight.position.set(0, blackHoleRadius * 3, blackHoleRadius * 3);
    // scene.add(pointLight);


    const blackHoleGeometry = new THREE.SphereGeometry(blackHoleRadius, 64, 64);
    const blackHoleMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const blackHole = new THREE.Mesh(blackHoleGeometry, blackHoleMaterial);
    scene.add(blackHole);
    blackHoleRef.current = blackHole;

    const diskGeometry = new THREE.RingGeometry(accretionDiskInnerRadius, accretionDiskOuterRadius, 128); // Increased segments for smoother UV mapping
    const diskMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0.0 },
        uBlackHoleRadius: { value: blackHoleRadius },
        uAccretionDiskInnerRadius: { value: accretionDiskInnerRadius },
        uAccretionDiskOuterRadius: { value: accretionDiskOuterRadius },
        uAccretionDiskOpacity: { value: accretionDiskOpacity },
      },
      side: THREE.DoubleSide,
      transparent: true,
    });
    const accretionDisk = new THREE.Mesh(diskGeometry, diskMaterial);
    accretionDisk.rotation.x = -Math.PI / 2;
    scene.add(accretionDisk);
    accretionDiskRef.current = accretionDisk;
    
    const starsGeometry = new THREE.BufferGeometry();
    const starVertices = [];
    for (let i = 0; i < 10000; i++) { // Increased star count
        const r = 50 + Math.random() * 250; 
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * Math.PI;
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.sin(theta) * Math.sin(phi);
        const z = r * Math.cos(theta);
        starVertices.push(x, y, z);
    }
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, sizeAttenuation: true });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);
    starsRef.current = stars;

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      if (accretionDiskRef.current && accretionDiskRef.current.material instanceof THREE.ShaderMaterial) {
        accretionDiskRef.current.material.uniforms.uTime.value += 0.005;
        // accretionDiskRef.current.rotation.z += 0.001; // Disk object rotation
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
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          const material = object.material as any; // To handle array or single
          if (Array.isArray(material)) {
            material.forEach(mat => mat.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      controlsRef.current?.dispose();
    };
  }, []); 

  useEffect(() => {
    if (blackHoleRef.current) {
      blackHoleRef.current.geometry.dispose(); 
      blackHoleRef.current.geometry = new THREE.SphereGeometry(blackHoleRadius, 64, 64);
    }
    if (accretionDiskRef.current) {
      accretionDiskRef.current.geometry.dispose();
      accretionDiskRef.current.geometry = new THREE.RingGeometry(
        accretionDiskInnerRadius,
        accretionDiskOuterRadius,
        128 // Keep segments consistent
      );
      accretionDiskRef.current.rotation.x = -Math.PI / 2;
      if (accretionDiskRef.current.material instanceof THREE.ShaderMaterial) {
        accretionDiskRef.current.material.uniforms.uAccretionDiskOpacity.value = accretionDiskOpacity;
        accretionDiskRef.current.material.uniforms.uBlackHoleRadius.value = blackHoleRadius;
        accretionDiskRef.current.material.uniforms.uAccretionDiskInnerRadius.value = accretionDiskInnerRadius;
        accretionDiskRef.current.material.uniforms.uAccretionDiskOuterRadius.value = accretionDiskOuterRadius;
      }
    }
    if (cameraRef.current && controlsRef.current) {
        controlsRef.current.minDistance = blackHoleRadius * 1.5;
    }

  }, [blackHoleRadius, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity]);

  return <div ref={mountRef} className="w-full h-full outline-none" data-ai-hint="space simulation" />;
};

export default ThreeBlackholeCanvas;


    