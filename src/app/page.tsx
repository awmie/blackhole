
"use client";

import React, { useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { SidebarProvider, Sidebar, SidebarInset, SidebarHeader, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';

// Dynamically import ThreeBlackholeCanvas to ensure it's client-side only
const ThreeBlackholeCanvas = React.lazy(() => import('@/components/event-horizon/three-blackhole-canvas'));

// Skeleton loader for ControlPanel
const ControlPanelSkeleton = () => (
  <div className="p-4 space-y-6">
    <Skeleton className="h-36 w-full rounded-lg bg-sidebar-accent/30" />
    <Skeleton className="h-52 w-full rounded-lg bg-sidebar-accent/30" />
    <Skeleton className="h-24 w-full rounded-lg bg-sidebar-accent/30" />
  </div>
);

// Dynamically import ControlPanel with SSR disabled
const ControlPanel = dynamic(() => import('@/components/event-horizon/control-panel'), {
  ssr: false,
  loading: () => <ControlPanelSkeleton />,
});


export default function Home() {
  const [blackHoleRadius, setBlackHoleRadius] = useState(1);
  const [accretionDiskInnerRadius, setAccretionDiskInnerRadius] = useState(1.5);
  const [accretionDiskOuterRadius, setAccretionDiskOuterRadius] = useState(3);
  const [accretionDiskOpacity, setAccretionDiskOpacity] = useState(0.8);
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 2, z: 5 });

  const handleCameraUpdate = (position: { x: number; y: number; z: number }) => {
    setCameraPosition(position);
  };

  // Ensure inner radius is always > blackHoleRadius and outer > inner
  const handleBlackHoleRadiusChange = (value: number) => {
    setBlackHoleRadius(value);
    if (accretionDiskInnerRadius <= value) {
      setAccretionDiskInnerRadius(value + 0.1);
      if (accretionDiskOuterRadius <= value + 0.1) {
        setAccretionDiskOuterRadius(value + 0.3);
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


  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar side="right" collapsible="icon" className="border-l border-sidebar-border shadow-2xl" variant="sidebar">
          <SidebarHeader className="p-2 flex justify-between items-center bg-sidebar-background border-b border-sidebar-border">
            <h1 className="text-lg font-headline text-sidebar-foreground px-2">Controls</h1>
            <SidebarTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
              </Button>
            </SidebarTrigger>
          </SidebarHeader>
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
          />
        </Sidebar>

        <SidebarInset className="flex-1 bg-background relative">
          <div className="absolute top-4 left-4 z-10 md:hidden">
             <SidebarTrigger asChild>
                <Button variant="outline" size="icon" className="bg-card/80 backdrop-blur-sm">
                   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </Button>
            </SidebarTrigger>
          </div>
          <Suspense fallback={<Skeleton className="w-full h-full bg-muted-foreground/20 rounded-none" />}>
            <ThreeBlackholeCanvas
              blackHoleRadius={blackHoleRadius}
              accretionDiskInnerRadius={accretionDiskInnerRadius}
              accretionDiskOuterRadius={accretionDiskOuterRadius}
              accretionDiskOpacity={accretionDiskOpacity}
              onCameraUpdate={handleCameraUpdate}
            />
          </Suspense>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
