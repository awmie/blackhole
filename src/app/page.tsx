
"use client";

import React, { useState, Suspense, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Info } from 'lucide-react';
// Assuming types are exported from three-blackhole-canvas or defined here
// For now, let's define PlanetState here for clarity as it's primarily used by page.tsx

export interface PlanetState {
  id: number;
  type: 'planet' | 'star';
  orbitRadius: number;
  currentAngle: number;
  angularVelocity: number;
  yOffset: number;
  color: string;
  initialScale: { x: number; y: number; z: number };
  currentScale: { x: number; y: number; z: number };
  timeToLive: number;
  isStretching: boolean;
  stretchAxis: { x: number; y: number; z: number };
  progressValue: number;
}

// Dynamically import ThreeBlackholeCanvas
const ThreeBlackholeCanvas = React.lazy(() => import('@/components/event-horizon/three-blackhole-canvas'));

// Dynamically import ControlPanel with SSR disabled
const ControlPanel = dynamic(() => import('@/components/event-horizon/control-panel'), {
  ssr: false,
  loading: () => <ControlPanelSkeleton />,
});

const ControlPanelSkeleton = () => (
  <div className="p-4 space-y-6">
    <Skeleton className="h-36 w-full rounded-lg bg-sidebar-accent/30" />
    <Skeleton className="h-52 w-full rounded-lg bg-sidebar-accent/30" />
    <Skeleton className="h-24 w-full rounded-lg bg-sidebar-accent/30" />
    <Skeleton className="h-20 w-full rounded-lg bg-sidebar-accent/30" />
  </div>
);

const HAWKING_RADIATION_THRESHOLD = 3;
const HAWKING_RADIATION_DURATION = 5000; // 5 seconds

export default function Home() {
  const [blackHoleRadius, setBlackHoleRadius] = useState(1);
  const [accretionDiskInnerRadius, setAccretionDiskInnerRadius] = useState(1.5);
  const [accretionDiskOuterRadius, setAccretionDiskOuterRadius] = useState(3);
  const [accretionDiskOpacity, setAccretionDiskOpacity] = useState(0.8);
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 2, z: 5 });

  const [spawnedObjects, setSpawnedObjects] = useState<PlanetState[]>([]);
  const [nextObjectId, setNextObjectId] = useState(0);
  const [absorbedObjectCount, setAbsorbedObjectCount] = useState(0);
  const [isEmittingJets, setIsEmittingJets] = useState(false);
  const [showControlsPanel, setShowControlsPanel] = useState(false); // Default to false, toggled by button

  const [selectedObjectType, setSelectedObjectType] = useState<'planet' | 'star'>('planet');
  const [simulationCamera, setSimulationCamera] = useState<THREE.PerspectiveCamera | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const handleCameraUpdate = useCallback((position: { x: number; y: number; z: number }) => {
    setCameraPosition(position);
  }, []);

  const handleBlackHoleRadiusChange = (value: number) => {
    setBlackHoleRadius(value);
    if (accretionDiskInnerRadius <= value) {
      const newInner = value + 0.1;
      setAccretionDiskInnerRadius(newInner);
      if (accretionDiskOuterRadius <= newInner) {
        setAccretionDiskOuterRadius(newInner + 0.2);
      }
    }
  };

  const handleAccretionDiskInnerRadiusChange = (value: number) => {
    if (value > blackHoleRadius) {
      setAccretionDiskInnerRadius(value);
      if (accretionDiskOuterRadius <= value) {
        setAccretionDiskOuterRadius(value + 0.2);
      }
    }
  };
  
  const handleAccretionDiskOuterRadiusChange = (value: number) => {
    if (value > accretionDiskInnerRadius) {
      setAccretionDiskOuterRadius(value);
    }
  };

  const handleSpawnObject = useCallback((clickPosition?: THREE.Vector3) => {
    const id = nextObjectId;
    setNextObjectId(prev => prev + 1);
    
    let orbitRadius, currentAngle, yOffset;

    if (clickPosition) {
      orbitRadius = Math.sqrt(clickPosition.x * clickPosition.x + clickPosition.z * clickPosition.z);
      currentAngle = Math.atan2(clickPosition.z, clickPosition.x);
      yOffset = clickPosition.y; // Or a small random value: (Math.random() - 0.5) * 0.1
    } else {
      orbitRadius = accretionDiskInnerRadius + (accretionDiskOuterRadius - accretionDiskInnerRadius) * (0.2 + Math.random() * 0.8);
      currentAngle = Math.random() * Math.PI * 2;
      yOffset = (Math.random() - 0.5) * 0.1;
    }
    
    const baseSpeed = 1.0;
    const minSpeedFactor = 0.02;
    let angularVelocity = baseSpeed * Math.pow(accretionDiskInnerRadius / orbitRadius, 2.5);
    angularVelocity = Math.max(angularVelocity, baseSpeed * minSpeedFactor) * (Math.random() > 0.5 ? 1 : -1);

    let color, initialScale;
    if (selectedObjectType === 'star') {
      color = '#FFFF99'; // Bright yellowish white for stars
      initialScale = { x: 0.2, y: 0.2, z: 0.2 };
    } else { // planet
      color = `hsl(${Math.random() * 360}, 70%, 60%)`;
      initialScale = { x: 0.1, y: 0.1, z: 0.1 };
    }

    const newObject: PlanetState = {
      id,
      type: selectedObjectType,
      orbitRadius,
      currentAngle,
      angularVelocity: angularVelocity * 0.5,
      yOffset,
      color,
      initialScale,
      currentScale: { ...initialScale },
      timeToLive: 60 + Math.random() * 60,
      isStretching: false,
      stretchAxis: { x: 0, y: 0, z: 1 },
      progressValue: 0,
    };
    setSpawnedObjects(prev => [...prev, newObject]);
  }, [nextObjectId, accretionDiskOuterRadius, accretionDiskInnerRadius, selectedObjectType]);

  const handleAbsorbObject = useCallback((objectId: number) => {
    setSpawnedObjects(prev => prev.filter(p => p.id !== objectId));
    setAbsorbedObjectCount(prev => {
      const newCount = prev + 1;
      if (newCount % HAWKING_RADIATION_THRESHOLD === 0 && newCount > 0) {
        setIsEmittingJets(true);
        setTimeout(() => setIsEmittingJets(false), HAWKING_RADIATION_DURATION);
      }
      return newCount;
    });
  }, []);

  const handleShiftClickSpawn = useCallback((event: PointerEvent) => {
    if (!event.shiftKey || !simulationCamera || !canvasContainerRef.current) return;

    const rect = canvasContainerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, simulationCamera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Spawning on Y=0 plane
    const intersectionPoint = new THREE.Vector3();
    
    if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
      handleSpawnObject(intersectionPoint);
    }
  }, [simulationCamera, handleSpawnObject]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (container) {
      container.addEventListener('pointerdown', handleShiftClickSpawn as EventListener);
      return () => {
        container.removeEventListener('pointerdown', handleShiftClickSpawn as EventListener);
      };
    }
  }, [handleShiftClickSpawn]);


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background relative" ref={canvasContainerRef}>
      <div className="absolute top-4 right-4 z-20">
        <Sheet open={showControlsPanel} onOpenChange={setShowControlsPanel}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="bg-card/80 backdrop-blur-sm text-foreground hover:bg-accent hover:text-accent-foreground">
              <Info className="h-5 w-5" />
              <span className="sr-only">Toggle Controls</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[350px] sm:w-[400px] bg-sidebar text-sidebar-foreground border-sidebar-border p-0">
            <SheetHeader className="p-4 border-b border-sidebar-border">
              <SheetTitle className="text-xl font-headline text-sidebar-foreground">Simulation Controls</SheetTitle>
            </SheetHeader>
            <ControlPanel
              blackHoleRadius={blackHoleRadius}
              setBlackHoleRadius={handleBlackHoleRadiusChange}
              accretionDiskInnerRadius={accretionDiskInnerRadius}
              setAccretionDiskInnerRadius={handleAccretionDiskInnerRadiusChange}
              accretionDiskOuterRadius={accretionDiskOuterRadius}
              setAccretionDiskOuterRadius={handleAccretionDiskOuterRadiusChange}
              accretionDiskOpacity={accretionDiskOpacity}
              setAccretionDiskOpacity={setAccretionDiskOpacity}
              cameraPosition={cameraPosition}
              onSpawnObjectClick={() => handleSpawnObject()} // Button click spawns without specific position
              selectedObjectType={selectedObjectType}
              setSelectedObjectType={setSelectedObjectType}
            />
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex-1 w-full h-full">
        <Suspense fallback={<Skeleton className="w-full h-full bg-muted-foreground/20 rounded-none" />}>
          <ThreeBlackholeCanvas
            blackHoleRadius={blackHoleRadius}
            accretionDiskInnerRadius={accretionDiskInnerRadius}
            accretionDiskOuterRadius={accretionDiskOuterRadius}
            accretionDiskOpacity={accretionDiskOpacity}
            onCameraUpdate={handleCameraUpdate}
            spawnedPlanets={spawnedObjects} // Renamed prop for clarity
            onAbsorbPlanet={handleAbsorbObject} // Prop name kept for now
            isEmittingJets={isEmittingJets}
            onCameraReady={setSimulationCamera}
          />
        </Suspense>
      </div>
    </div>
  );
}
