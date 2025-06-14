
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
  const accretionDiskRef = useRef<THREE.Points | null>(null); // Changed to THREE.Points
  const starsRef = useRef<THREE.Points | null>(null);

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
    const colors = new Float32Array(NUM_PARTICLES * 3);

    const colorInner = new THREE.Color(1.0, 0.4, 0.8); // Pinkish/Magenta
    const colorMid = new THREE.Color(0.6, 0.3, 0.9);   // Purple
    const colorOuter = new THREE.Color(0.2, 0.1, 0.7); // Darker Blue/Purple
    const colorPhotonRing = new THREE.Color(1.0, 0.95, 0.85); // Bright yellowish-white

    for (let i = 0; i < NUM_PARTICLES; i++) {
      const i3 = i * 3;
      const radius = Math.random() * (outerR - innerR) + innerR;
      const angle = Math.random() * Math.PI * 2;
      const yOffset = (Math.random() - 0.5) * 0.4; // Cloud thickness

      positions[i3] = radius * Math.cos(angle);
      positions[i3 + 1] = yOffset;
      positions[i3 + 2] = radius * Math.sin(angle);

      let normalizedDist = (radius - innerR) / (outerR - innerR);
      normalizedDist = Math.max(0, Math.min(1, normalizedDist)); // Clamp [0,1]

      const particleColor = new THREE.Color();
      if (normalizedDist < 0.5) {
        particleColor.lerpColors(colorInner, colorMid, normalizedDist * 2.0);
      } else {
        particleColor.lerpColors(colorMid, colorOuter, (normalizedDist - 0.5) * 2.0);
      }

      const innerEdgeFactor = 1.0 - Math.min(1.0, Math.max(0.0, normalizedDist / 0.2));
      particleColor.r += particleColor.r * innerEdgeFactor * 0.8;
      particleColor.g += particleColor.g * innerEdgeFactor * 0.8;
      particleColor.b += particleColor.b * innerEdgeFactor * 0.8;
      
      if (normalizedDist < 0.03) {
        let photonRingIntensity = (0.03 - normalizedDist) / 0.03;
        photonRingIntensity = Math.pow(photonRingIntensity, 2.0);
        particleColor.r += colorPhotonRing.r * photonRingIntensity * 2.0;
        particleColor.g += colorPhotonRing.g * photonRingIntensity * 2.0;
        particleColor.b += colorPhotonRing.b * photonRingIntensity * 2.0;
      }

      particleColor.r = Math.min(1.0, Math.max(0.0, particleColor.r));
      particleColor.g = Math.min(1.0, Math.max(0.0, particleColor.g));
      particleColor.b = Math.min(1.0, Math.max(0.0, particleColor.b));

      colors[i3] = particleColor.r;
      colors[i3 + 1] = particleColor.g;
      colors[i3 + 2] = particleColor.b;
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.03,
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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // Slightly brighter ambient
    scene.add(ambientLight);

    const blackHoleGeometry = new THREE.SphereGeometry(blackHoleRadius, 64, 64);
    const blackHoleMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const blackHole = new THREE.Mesh(blackHoleGeometry, blackHoleMaterial);
    scene.add(blackHole);
    blackHoleRef.current = blackHole;

    createAndAddAccretionParticles(scene, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
    
    const starsGeometry = new THREE.BufferGeometry();
    const starVertices = [];
    for (let i = 0; i < 20000; i++) { // Increased star count
        const r = 100 + Math.random() * 300; 
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * Math.PI;
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.sin(theta) * Math.sin(phi);
        const z = r * Math.cos(theta);
        starVertices.push(x, y, z);
    }
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, sizeAttenuation: true }); // Slightly larger stars
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);
    starsRef.current = stars;

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      if (accretionDiskRef.current) {
        accretionDiskRef.current.rotation.y += 0.0005; // Slower rotation for a grander scale
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
      if (accretionDiskRef.current) { // Ensure disposal if component unmounts before accretionDiskRef is cleared by updates
         accretionDiskRef.current.geometry?.dispose();
         if (Array.isArray(accretionDiskRef.current.material)) {
            accretionDiskRef.current.material.forEach(m => m.dispose());
         } else {
            (accretionDiskRef.current.material as THREE.Material)?.dispose();
         }
      }
      controlsRef.current?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Update black hole size and camera min distance
  useEffect(() => {
    if (blackHoleRef.current) {
      blackHoleRef.current.geometry.dispose(); 
      blackHoleRef.current.geometry = new THREE.SphereGeometry(blackHoleRadius, 64, 64);
    }
    if (controlsRef.current) {
        controlsRef.current.minDistance = blackHoleRadius * 1.5;
    }
  }, [blackHoleRadius]);

  // Regenerate accretion disk particles when radii change
  useEffect(() => {
    if (sceneRef.current) {
       createAndAddAccretionParticles(
        sceneRef.current,
        accretionDiskInnerRadius,
        accretionDiskOuterRadius,
        accretionDiskOpacity // Pass current opacity to maintain it
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accretionDiskInnerRadius, accretionDiskOuterRadius]); // blackHoleRadius removed as it doesn't directly define particle distribution here

  // Update accretion disk opacity
  useEffect(() => {
    if (accretionDiskRef.current && accretionDiskRef.current.material instanceof THREE.PointsMaterial) {
      accretionDiskRef.current.material.opacity = accretionDiskOpacity;
    }
  }, [accretionDiskOpacity]);


  return <div ref={mountRef} className="w-full h-full outline-none" data-ai-hint="space simulation" />;
};

export default ThreeBlackholeCanvas;
