
"use client";

import React, { useState, Suspense, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Info, Atom, Sparkles } from 'lucide-react';
import type { PlanetState, JetParticleState } from '@/components/event-horizon/three-blackhole-canvas'; // Assuming types are exported

// Dynamically import ThreeBlackholeCanvas to ensure it's client-side only
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

const HAWKING_RADIATION_THRESHOLD = 3; // Number of absorptions to trigger jets
const HAWKING_RADIATION_DURATION = 5000; // 5 seconds

export default function Home() {
  const [blackHoleRadius, setBlackHoleRadius] = useState(1);
  const [accretionDiskInnerRadius, setAccretionDiskInnerRadius] = useState(1.5);
  const [accretionDiskOuterRadius, setAccretionDiskOuterRadius] = useState(3);
  const [accretionDiskOpacity, setAccretionDiskOpacity] = useState(0.8);
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 2, z: 5 });

  const [spawnedPlanets, setSpawnedPlanets] = useState<PlanetState[]>([]);
  const [nextPlanetId, setNextPlanetId] = useState(0);
  const [absorbedPlanetCount, setAbsorbedPlanetCount] = useState(0);
  const [isEmittingJets, setIsEmittingJets] = useState(false);
  const [showControlsPanel, setShowControlsPanel] = useState(true);


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

  const handleSpawnPlanet = useCallback(() => {
    const id = nextPlanetId;
    setNextPlanetId(prev => prev + 1);
    
    const orbitRadius = accretionDiskOuterRadius * (0.8 + Math.random() * 0.4); // Spawn near outer edge, slightly randomized
    const angle = Math.random() * Math.PI * 2;
    const yOffset = (Math.random() - 0.5) * 0.1; // Slight vertical variation
    
    // Simplified angular velocity - make it orbit roughly with outer disk particles
    const baseSpeed = 1.0; // Matches baseAngularSpeed in canvas
    const minSpeedFactor = 0.02; // Matches minAngularSpeedFactor
    let angularVelocity = baseSpeed * Math.pow(accretionDiskInnerRadius / orbitRadius, 2.5);
    angularVelocity = Math.max(angularVelocity, baseSpeed * minSpeedFactor) * (Math.random() > 0.5 ? 1 : -1); // Random direction

    const newPlanet: PlanetState = {
      id,
      orbitRadius,
      currentAngle: angle,
      angularVelocity: angularVelocity * 0.5, // Slower than disk particles initially
      yOffset,
      color: `hsl(${Math.random() * 360}, 70%, 60%)`,
      initialScale: { x: 0.1, y: 0.1, z: 0.1 }, // Planet size
      currentScale: { x: 0.1, y: 0.1, z: 0.1 },
      timeToLive: 60 + Math.random() * 60, // Seconds before it might decay or get pulled in
      isStretching: false,
      stretchAxis: { x: 0, y: 0, z: 1 }, // Default stretch along Z
      progressValue: 0, // for animation, if needed
    };
    setSpawnedPlanets(prev => [...prev, newPlanet]);
  }, [nextPlanetId, accretionDiskOuterRadius, accretionDiskInnerRadius]);

  const handleAbsorbPlanet = useCallback((planetId: number) => {
    setSpawnedPlanets(prev => prev.filter(p => p.id !== planetId));
    setAbsorbedPlanetCount(prev => {
      const newCount = prev + 1;
      if (newCount % HAWKING_RADIATION_THRESHOLD === 0 && newCount > 0) {
        setIsEmittingJets(true);
        setTimeout(() => setIsEmittingJets(false), HAWKING_RADIATION_DURATION);
      }
      return newCount;
    });
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
              onSpawnPlanetClick={handleSpawnPlanet}
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
            spawnedPlanets={spawnedPlanets}
            onAbsorbPlanet={handleAbsorbPlanet}
            isEmittingJets={isEmittingJets}
          />
        </Suspense>
      </div>
    </div>
  );
}
