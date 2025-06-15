
"use client";

import React, { useState, Suspense, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Info, Zap } from 'lucide-react';


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
  currentMassFactor?: number;
  position?: { x: number; y: number; z: number }; // Added for collision detection
}

export interface CollisionEvent {
  id: string; // Unique ID for the event
  point: { x: number; y: number; z: number };
  color1: string;
  color2: string;
  objectId1: number;
  objectId2: number;
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
    <Skeleton className="h-20 w-full rounded-lg bg-sidebar-accent/30" />
  </div>
);

const HAWKING_RADIATION_THRESHOLD = 3;
const HAWKING_RADIATION_DURATION = 5000; // ms
const SPAWNED_OBJECT_BASE_SPEED = 2.0;
const SPAWNED_OBJECT_MIN_SPEED_FACTOR = 0.02;
const SPAWNED_OBJECT_SPEED_SCALAR = 1.0;
const CLOSE_SPAWN_TIME_TO_LIVE = 2.0;
const CLOSE_SPAWN_RADIUS_FACTOR = 1.3;
const DISSOLUTION_EFFECT_DURATION = 1.5;
const COLLISION_DISSOLUTION_DURATION = 1.0; // Objects shatter and get absorbed quickly
const STAR_MIN_MASS_FACTOR_BEFORE_DISSOLUTION = 0.1;
const COLLISION_CHECK_RADIUS_MULTIPLIER_PLANET = 0.8; // Adjust for tighter collision box
const COLLISION_CHECK_RADIUS_MULTIPLIER_STAR = 0.8;   // Adjust for tighter collision box


export default function Home() {
  const [blackHoleRadius, setBlackHoleRadius] = useState(1);
  const [accretionDiskInnerRadius, setAccretionDiskInnerRadius] = useState(1.5);
  const [accretionDiskOuterRadius, setAccretionDiskOuterRadius] = useState(3);
  const [accretionDiskOpacity, setAccretionDiskOpacity] = useState(0.8);
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 2, z: 5 });
  const [simulationSpeed, setSimulationSpeed] = useState(1.5); 

  const [spawnedObjects, setSpawnedObjects] = useState<PlanetState[]>([]);
  const [nextObjectId, setNextObjectId] = useState(0);
  const [absorbedObjectCount, setAbsorbedObjectCount] = useState(0);
  const [isEmittingJets, setIsEmittingJets] = useState(false);
  const [showControlsPanel, setShowControlsPanel] = useState(false);

  const [selectedObjectType, setSelectedObjectType] = useState<'planet' | 'star'>('planet');
  const [simulationCamera, setSimulationCamera] = useState<THREE.PerspectiveCamera | null>(null);

  const [collisionEvents, setCollisionEvents] = useState<CollisionEvent[]>([]);
  const recentlyCollidedPairs = useRef<Set<string>>(new Set());


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
      objectOrbitRadius = Math.max(objectOrbitRadius, blackHoleRadius * 0.98); 
    } else {
      objectOrbitRadius = accretionDiskInnerRadius + (accretionDiskOuterRadius - accretionDiskInnerRadius) * (0.2 + Math.random() * 0.8);
      currentAngle = Math.random() * Math.PI * 2;
      yOffset = (Math.random() - 0.5) * 0.1;
    }

    let angularVelocity = SPAWNED_OBJECT_BASE_SPEED * Math.pow(accretionDiskInnerRadius / objectOrbitRadius, 2.5);
    angularVelocity = Math.max(angularVelocity, SPAWNED_OBJECT_BASE_SPEED * SPAWNED_OBJECT_MIN_SPEED_FACTOR);
    angularVelocity *= SPAWNED_OBJECT_SPEED_SCALAR * simulationSpeed; 
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
      position: { // Initial rough position, canvas will update accurately
        x: objectOrbitRadius * Math.cos(currentAngle),
        y: yOffset,
        z: objectOrbitRadius * Math.sin(currentAngle),
      }
    };
    setSpawnedObjects(prev => [...prev, newObject]);
  }, [nextObjectId, blackHoleRadius, accretionDiskOuterRadius, accretionDiskInnerRadius, selectedObjectType, simulationSpeed]);

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
            return {
              ...obj,
              currentMassFactor: newMassFactor,
              isDissolving: true,
              timeToLive: Math.min(obj.timeToLive, DISSOLUTION_EFFECT_DURATION * 1.2)
            };
          }
          return { ...obj, currentMassFactor: newMassFactor };
        }
        return obj;
      })
    );
  }, []);

  const handleUpdatePlanetPosition = useCallback((objectId: number, position: {x:number, y:number, z:number}) => {
    setSpawnedObjects(prev => prev.map(obj => obj.id === objectId ? {...obj, position} : obj));
  }, []);

  useEffect(() => {
    // Collision detection logic
    const activeObjects = spawnedObjects.filter(obj => !obj.isDissolving);
    if (activeObjects.length < 2) return;

    const newCollisionEvents: CollisionEvent[] = [];
    const updatedObjects = [...spawnedObjects]; // Create a mutable copy
    let collisionOccurredThisTick = false;

    for (let i = 0; i < activeObjects.length; i++) {
      for (let j = i + 1; j < activeObjects.length; j++) {
        const obj1 = activeObjects[i];
        const obj2 = activeObjects[j];

        if (!obj1.position || !obj2.position) continue; // Position not updated yet

        const pairKey1 = `${obj1.id}-${obj2.id}`;
        const pairKey2 = `${obj2.id}-${obj1.id}`;
        if (recentlyCollidedPairs.current.has(pairKey1) || recentlyCollidedPairs.current.has(pairKey2)) {
            continue;
        }

        const dx = obj1.position.x - obj2.position.x;
        const dy = obj1.position.y - obj2.position.y;
        const dz = obj1.position.z - obj2.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const radius1 = obj1.type === 'star' 
                        ? obj1.initialScale.x * (obj1.currentMassFactor || 1.0) * COLLISION_CHECK_RADIUS_MULTIPLIER_STAR
                        : obj1.initialScale.x * COLLISION_CHECK_RADIUS_MULTIPLIER_PLANET;
        const radius2 = obj2.type === 'star'
                        ? obj2.initialScale.x * (obj2.currentMassFactor || 1.0) * COLLISION_CHECK_RADIUS_MULTIPLIER_STAR
                        : obj2.initialScale.x * COLLISION_CHECK_RADIUS_MULTIPLIER_PLANET;
        
        if (distance < radius1 + radius2) {
          // Collision detected
          const collisionPoint = {
            x: obj1.position.x + dx * (radius1 / (radius1 + radius2)), // Midpoint weighted by radius, roughly
            y: obj1.position.y + dy * (radius1 / (radius1 + radius2)),
            z: obj1.position.z + dz * (radius1 / (radius1 + radius2)),
          };

          newCollisionEvents.push({
            id: `${Date.now()}-${obj1.id}-${obj2.id}`,
            point: collisionPoint,
            color1: obj1.color,
            color2: obj2.color,
            objectId1: obj1.id,
            objectId2: obj2.id,
          });
          
          recentlyCollidedPairs.current.add(pairKey1);
          recentlyCollidedPairs.current.add(pairKey2);

          const markAsColliding = (id: number) => {
            const index = updatedObjects.findIndex(obj => obj.id === id);
            if (index !== -1 && !updatedObjects[index].isDissolving) {
              updatedObjects[index] = {
                ...updatedObjects[index],
                isDissolving: true,
                timeToLive: COLLISION_DISSOLUTION_DURATION,
              };
              collisionOccurredThisTick = true;
            }
          };

          markAsColliding(obj1.id);
          markAsColliding(obj2.id);
        }
      }
    }

    if (newCollisionEvents.length > 0) {
      setCollisionEvents(prev => [...prev, ...newCollisionEvents]);
    }
    if (collisionOccurredThisTick) {
      setSpawnedObjects(updatedObjects);
    }
    // Clear recentlyCollidedPairs for next frame/tick if needed, or manage its size
    // For now, this simple set might grow. A better approach for persistent recentlyCollidedPairs
    // would involve removing them after the objects are fully absorbed.
    // For simplicity here, let's clear it periodically or when objects are absorbed.
    // This effect ensures a pair doesn't continually trigger if logic runs fast.
    const timeoutId = setTimeout(() => recentlyCollidedPairs.current.clear(), 500); // Clear after a short delay
    return () => clearTimeout(timeoutId);

  }, [spawnedObjects, simulationSpeed]); // simulationSpeed ensures re-check if dynamics change

  const handleCollisionEventProcessed = useCallback((eventId: string) => {
    setCollisionEvents(prev => prev.filter(event => event.id !== eventId));
  }, []);


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background relative">
      <div className="absolute top-4 left-4 z-20">
        <Button 
          variant="outline" 
          size="icon" 
          className="bg-card/80 backdrop-blur-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={handleManualJetEmission}
          title="Trigger Hawking Radiation Jets"
        >
          <Zap className="h-5 w-5" />
          <span className="sr-only">Trigger Jets</span>
        </Button>
      </div>
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
              simulationSpeed={simulationSpeed}
              setSimulationSpeed={setSimulationSpeed}
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
            onUpdatePlanetPosition={handleUpdatePlanetPosition}
            collisionEvents={collisionEvents}
            onCollisionEventProcessed={handleCollisionEventProcessed}
          />
        </Suspense>
      </div>
    </div>
  );
}

