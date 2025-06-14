
"use client";

import React, { useState, Suspense, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Info } from 'lucide-react';


export interface PlanetState {
  id: number;
  type: 'planet' | 'star';
  orbitRadius: number;
  currentAngle: number;
  angularVelocity: number;
  yOffset: number;
  color: string;
  initialScale: { x: number; y: number; z: number };
  timeToLive: number;
  isDissolving: boolean;
  currentMassFactor?: number; // For stars, starts at 1.0 and decreases
}

const ThreeBlackholeCanvas = React.lazy(() => import('@/components/event-horizon/three-blackhole-canvas'));

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
     <Skeleton className="h-20 w-full rounded-lg bg-sidebar-accent/30" />
  </div>
);

const HAWKING_RADIATION_THRESHOLD = 3;
const HAWKING_RADIATION_DURATION = 5000; // ms
const SPAWNED_OBJECT_BASE_SPEED = 2.0;
const SPAWNED_OBJECT_MIN_SPEED_FACTOR = 0.02;
const SPAWNED_OBJECT_SPEED_SCALAR = 1.5; 
const CLOSE_SPAWN_TIME_TO_LIVE = 2.0; 
const CLOSE_SPAWN_RADIUS_FACTOR = 1.3;
const DISSOLUTION_EFFECT_DURATION = 1.5; 
const STAR_MIN_MASS_FACTOR_BEFORE_DISSOLUTION = 0.1;


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
  const [showControlsPanel, setShowControlsPanel] = useState(false);

  const [selectedObjectType, setSelectedObjectType] = useState<'planet' | 'star'>('planet');

  const [, setSimulationCamera] = useState<THREE.PerspectiveCamera | null>(null);


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

    let objectOrbitRadius, currentAngle, yOffset;

    if (clickPosition) {
      objectOrbitRadius = Math.sqrt(clickPosition.x * clickPosition.x + clickPosition.z * clickPosition.z);
      currentAngle = Math.atan2(clickPosition.z, clickPosition.x);
      yOffset = clickPosition.y;
      objectOrbitRadius = Math.max(objectOrbitRadius, blackHoleRadius + 0.1); 
    } else {
      objectOrbitRadius = accretionDiskInnerRadius + (accretionDiskOuterRadius - accretionDiskInnerRadius) * (0.2 + Math.random() * 0.8);
      currentAngle = Math.random() * Math.PI * 2;
      yOffset = (Math.random() - 0.5) * 0.1;
    }

    let angularVelocity = SPAWNED_OBJECT_BASE_SPEED * Math.pow(accretionDiskInnerRadius / objectOrbitRadius, 2.5);
    angularVelocity = Math.max(angularVelocity, SPAWNED_OBJECT_BASE_SPEED * SPAWNED_OBJECT_MIN_SPEED_FACTOR);
    angularVelocity *= SPAWNED_OBJECT_SPEED_SCALAR; 
    angularVelocity = Math.abs(angularVelocity);


    let color, initialScale, currentMassFactor;
    if (selectedObjectType === 'star') {
      color = '#FFFF99'; 
      initialScale = { x: 0.2, y: 0.2, z: 0.2 };
      currentMassFactor = 1.0;
    } else {
      color = `hsl(${Math.random() * 360}, 70%, 60%)`;
      initialScale = { x: 0.1, y: 0.1, z: 0.1 };
      currentMassFactor = undefined;
    }
    
    let timeToLive = 60 + Math.random() * 60;
    if (objectOrbitRadius < blackHoleRadius * CLOSE_SPAWN_RADIUS_FACTOR) {
      timeToLive = CLOSE_SPAWN_TIME_TO_LIVE;
    }

    const newObject: PlanetState = {
      id,
      type: selectedObjectType,
      orbitRadius: objectOrbitRadius,
      currentAngle,
      angularVelocity: angularVelocity,
      yOffset,
      color,
      initialScale,
      timeToLive: timeToLive,
      isDissolving: false,
      currentMassFactor,
    };
    setSpawnedObjects(prev => [...prev, newObject]);
  }, [nextObjectId, blackHoleRadius, accretionDiskOuterRadius, accretionDiskInnerRadius, selectedObjectType]);

  const triggerJetEmission = useCallback(() => {
    if (isEmittingJets) return; 
    setIsEmittingJets(true);
    setTimeout(() => setIsEmittingJets(false), HAWKING_RADIATION_DURATION);
  }, [isEmittingJets]);

  const handleAbsorbObject = useCallback((objectId: number) => {
    setSpawnedObjects(prev => prev.filter(p => p.id !== objectId));
    setAbsorbedObjectCount(prev => {
      const newCount = prev + 1;
      if (newCount % HAWKING_RADIATION_THRESHOLD === 0 && newCount > 0) {
        triggerJetEmission();
      }
      return newCount;
    });
  }, [triggerJetEmission]);

  const handleManualJetEmission = useCallback(() => {
    triggerJetEmission();
  }, [triggerJetEmission]);


  const handleSetPlanetDissolving = useCallback((objectId: number, dissolving: boolean) => {
    setSpawnedObjects(prevObjects => 
      prevObjects.map(obj => 
        obj.id === objectId ? { ...obj, isDissolving: dissolving, timeToLive: dissolving ? DISSOLUTION_EFFECT_DURATION : obj.timeToLive } : obj
      )
    );
  }, []);

  const handleStarMassLoss = useCallback((starId: number, massLossAmount: number) => {
    setSpawnedObjects(prevObjects =>
      prevObjects.map(obj => {
        if (obj.id === starId && obj.type === 'star') {
          const newMassFactor = Math.max(STAR_MIN_MASS_FACTOR_BEFORE_DISSOLUTION, (obj.currentMassFactor ?? 1.0) - massLossAmount);
          if (newMassFactor <= STAR_MIN_MASS_FACTOR_BEFORE_DISSOLUTION && !obj.isDissolving) {
            // If mass is critically low, trigger dissolution or ensure it will be absorbed soon
            return { 
              ...obj, 
              currentMassFactor: newMassFactor, 
              isDissolving: true, // Start dissolving effect
              timeToLive: Math.min(obj.timeToLive, DISSOLUTION_EFFECT_DURATION * 1.2) // Ensure it dissolves quickly
            };
          }
          return { ...obj, currentMassFactor: newMassFactor };
        }
        return obj;
      })
    );
  }, []);


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background relative">
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
              onSpawnObjectClick={() => handleSpawnObject()}
              selectedObjectType={selectedObjectType}
              setSelectedObjectType={setSelectedObjectType}
              onManualJetEmissionClick={handleManualJetEmission}
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
            spawnedPlanets={spawnedObjects}
            onAbsorbPlanet={handleAbsorbObject}
            onSetPlanetDissolving={handleSetPlanetDissolving}
            isEmittingJets={isEmittingJets}
            onCameraReady={setSimulationCamera}
            onShiftClickSpawnAtPoint={handleSpawnObject}
            onStarMassLoss={handleStarMassLoss}
          />
        </Suspense>
      </div>
    </div>
  );
}

