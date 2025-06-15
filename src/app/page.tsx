
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
  velocity: { x: number; y: number; z: number }; 
  yOffset: number;
  color: string;
  initialScale: { x: number; y: number; z: number };
  timeToLive: number;
  isDissolving: boolean;
  currentMassFactor?: number; 
  position?: { x: number; y: number; z: number }; 
}

export interface CollisionEvent {
  id: string;
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
const HAWKING_RADIATION_DURATION = 5000; 
const SPAWNED_OBJECT_BASE_SPEED_MAGNITUDE = 1.0; 
const SPAWNED_OBJECT_MIN_SPEED_FACTOR = 0.02; 
const SPAWNED_OBJECT_SPEED_SCALAR = 1.0; 
const CLOSE_SPAWN_TIME_TO_LIVE = 2.0;
const CLOSE_SPAWN_RADIUS_FACTOR = 1.3;
const DISSOLUTION_EFFECT_DURATION = 1.5;
const COLLISION_DISSOLUTION_DURATION = 1.0;
const STAR_MIN_MASS_FACTOR_BEFORE_DISSOLUTION = 0.1;
const COLLISION_CHECK_RADIUS_MULTIPLIER_PLANET = 0.8;
const COLLISION_CHECK_RADIUS_MULTIPLIER_STAR = 0.8;


export default function Home() {
  const [blackHoleRadius, setBlackHoleRadius] = useState(1);
  const [accretionDiskInnerRadius, setAccretionDiskInnerRadius] = useState(0);
  const [accretionDiskOuterRadius, setAccretionDiskOuterRadius] = useState(3);
  const [accretionDiskOpacity, setAccretionDiskOpacity] = useState(0.8);
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 2, z: 5 });
  const [simulationSpeed, setSimulationSpeed] = useState(1.0);

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
  };

  const handleAccretionDiskInnerRadiusChange = (value: number) => {
    if (value >= 0 && value < accretionDiskOuterRadius) {
      setAccretionDiskInnerRadius(value);
    } else if (value >= accretionDiskOuterRadius) {
      setAccretionDiskInnerRadius(Math.max(0, accretionDiskOuterRadius - 0.1));
    } else if (value < 0) {
      setAccretionDiskInnerRadius(0);
    }
  };

  const handleAccretionDiskOuterRadiusChange = (value: number) => {
    if (value > accretionDiskInnerRadius && value >= 0.1) {
      setAccretionDiskOuterRadius(value);
    } else if (value <= accretionDiskInnerRadius) {
      setAccretionDiskOuterRadius(accretionDiskInnerRadius + 0.1);
    } else if (value < 0.1) {
      setAccretionDiskOuterRadius(Math.max(0.1, accretionDiskInnerRadius + 0.1));
    }
  };

  const handleSpawnObject = useCallback((clickPosition?: THREE.Vector3) => {
    const id = nextObjectId;
    setNextObjectId(prev => prev + 1);

    let objectInitialOrbitRadius, initialAngle, yOffset;
    let initialPosX, initialPosY, initialPosZ;

    const diskEffectiveInnerRadiusForSpawning = Math.max(accretionDiskInnerRadius, blackHoleRadius);
    const diskEffectiveOuterRadiusForSpawning = Math.max(accretionDiskOuterRadius, diskEffectiveInnerRadiusForSpawning + 0.2);

    if (clickPosition) {
      initialPosX = clickPosition.x;
      initialPosY = clickPosition.y;
      initialPosZ = clickPosition.z;
      objectInitialOrbitRadius = Math.sqrt(clickPosition.x * clickPosition.x + clickPosition.z * clickPosition.z);
      initialAngle = Math.atan2(clickPosition.z, clickPosition.x);
      yOffset = clickPosition.y;
      if (objectInitialOrbitRadius < blackHoleRadius * 0.98) {
          const normX = clickPosition.x / objectInitialOrbitRadius;
          const normZ = clickPosition.z / objectInitialOrbitRadius;
          objectInitialOrbitRadius = blackHoleRadius * 0.98;
          initialPosX = normX * objectInitialOrbitRadius;
          initialPosZ = normZ * objectInitialOrbitRadius;
      }

    } else {
      objectInitialOrbitRadius = diskEffectiveInnerRadiusForSpawning + (diskEffectiveOuterRadiusForSpawning - diskEffectiveInnerRadiusForSpawning) * (0.2 + Math.random() * 0.8);
      initialAngle = Math.random() * Math.PI * 2;
      yOffset = (Math.random() - 0.5) * 0.1;
      initialPosX = objectInitialOrbitRadius * Math.cos(initialAngle);
      initialPosY = yOffset;
      initialPosZ = objectInitialOrbitRadius * Math.sin(initialAngle);
    }

    objectInitialOrbitRadius = Math.max(objectInitialOrbitRadius, 0.01);

    let initialSpeedMagnitude = SPAWNED_OBJECT_BASE_SPEED_MAGNITUDE * Math.pow(Math.max(0.1, blackHoleRadius) / objectInitialOrbitRadius, 0.5);
    initialSpeedMagnitude = Math.max(initialSpeedMagnitude, SPAWNED_OBJECT_BASE_SPEED_MAGNITUDE * SPAWNED_OBJECT_MIN_SPEED_FACTOR);
    initialSpeedMagnitude *= SPAWNED_OBJECT_SPEED_SCALAR;

    const initialVelocity = {
        x: -initialSpeedMagnitude * Math.sin(initialAngle),
        y: 0,
        z: initialSpeedMagnitude * Math.cos(initialAngle)
    };

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
    if (objectInitialOrbitRadius < blackHoleRadius * CLOSE_SPAWN_RADIUS_FACTOR) {
      timeToLive = CLOSE_SPAWN_TIME_TO_LIVE;
    }

    const newObject: PlanetState = {
      id,
      type: selectedObjectType,
      orbitRadius: objectInitialOrbitRadius,
      currentAngle: initialAngle,
      velocity: initialVelocity,
      yOffset,
      color,
      initialScale,
      timeToLive: timeToLive,
      isDissolving: false,
      currentMassFactor,
      position: {
        x: initialPosX,
        y: initialPosY,
        z: initialPosZ,
      }
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

  const handleUpdatePlanetPosition = useCallback((objectId: number, newPosition: {x:number, y:number, z:number}, newVelocity: {x:number, y:number, z:number}) => {
    setSpawnedObjects(prev => prev.map(obj => obj.id === objectId ? {...obj, position: newPosition, velocity: newVelocity} : obj));
  }, []);

  useEffect(() => {
    const activeObjects = spawnedObjects.filter(obj => !obj.isDissolving);
    if (activeObjects.length < 2) return;

    const newCollisionEvents: CollisionEvent[] = [];
    const updatedObjects = [...spawnedObjects];
    let collisionOccurredThisTick = false;

    for (let i = 0; i < activeObjects.length; i++) {
      for (let j = i + 1; j < activeObjects.length; j++) {
        const obj1 = activeObjects[i];
        const obj2 = activeObjects[j];

        if (!obj1.position || !obj2.position) continue;

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
          const collisionPoint = {
            x: obj1.position.x + dx * (radius1 / (radius1 + radius2)),
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

    const timeoutId = setTimeout(() => recentlyCollidedPairs.current.clear(), 500);
    return () => clearTimeout(timeoutId);

  }, [spawnedObjects]);

  const handleCollisionEventProcessed = useCallback((eventId: string) => {
    setCollisionEvents(prev => prev.filter(event => event.id !== eventId));
  }, []);

  const effectiveCanvasInnerRadius = Math.max(accretionDiskInnerRadius, blackHoleRadius);
  const effectiveCanvasOuterRadius = Math.max(accretionDiskOuterRadius, effectiveCanvasInnerRadius + 0.1);


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background relative">
      <div className="absolute top-4 left-4 z-20">
        <Button
          variant="outline"
          size="icon"
          className="bg-card/70 backdrop-blur-md text-foreground hover:bg-accent hover:text-accent-foreground"
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
            <Button variant="outline" size="icon" className="bg-card/70 backdrop-blur-md text-foreground hover:bg-accent hover:text-accent-foreground">
              <Info className="h-5 w-5" />
              <span className="sr-only">Toggle Controls</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[350px] sm:w-[400px] bg-sidebar/70 backdrop-blur-lg text-sidebar-foreground border-sidebar-border/50 p-0 flex flex-col"
          >
            <SheetHeader className="p-4 border-b border-sidebar-border/50">
              <SheetTitle className="text-xl font-headline text-sidebar-foreground">Simulation Controls</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
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
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex-1 w-full h-full">
        <Suspense fallback={<Skeleton className="w-full h-full bg-muted-foreground/20 rounded-none" />}>
          <ThreeBlackholeCanvas
            blackHoleRadius={blackHoleRadius}
            accretionDiskInnerRadius={effectiveCanvasInnerRadius}
            accretionDiskOuterRadius={effectiveCanvasOuterRadius}
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
            simulationSpeed={simulationSpeed}
          />
        </Suspense>
      </div>
    </div>
  );
}

