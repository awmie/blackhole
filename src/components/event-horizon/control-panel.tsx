
"use client";

import React from 'react';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sun, ArrowLineLeft, ArrowLineRight, Stack, Ruler, Cube, Database, Atom, Lightning, Gauge } from '@phosphor-icons/react';

interface ControlPanelProps {
  blackHoleRadius: number;
  setBlackHoleRadius: (value: number) => void;
  accretionDiskInnerRadius: number;
  setAccretionDiskInnerRadius: (value: number) => void;
  accretionDiskOuterRadius: number;
  setAccretionDiskOuterRadius: (value: number) => void;
  accretionDiskOpacity: number;
  setAccretionDiskOpacity: (value: number) => void;
  cameraPosition: { x: number; y: number; z: number };
  onSpawnObjectClick: () => void;
  selectedObjectType: 'planet' | 'star';
  setSelectedObjectType: (type: 'planet' | 'star') => void;
  onManualJetEmissionClick: () => void;
  simulationSpeed: number;
  setSimulationSpeed: (value: number) => void;
  starAbsorptionJetTriggerCount: number;
  planetAbsorptionJetTriggerCount: number;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  blackHoleRadius,
  setBlackHoleRadius,
  accretionDiskInnerRadius,
  setAccretionDiskInnerRadius,
  accretionDiskOuterRadius,
  setAccretionDiskOuterRadius,
  accretionDiskOpacity,
  setAccretionDiskOpacity,
  cameraPosition,
  onSpawnObjectClick,
  selectedObjectType,
  setSelectedObjectType,
  onManualJetEmissionClick,
  simulationSpeed,
  setSimulationSpeed,
  starAbsorptionJetTriggerCount,
  planetAbsorptionJetTriggerCount,
}) => {
  const calculatedSchwarzschildRadius = (blackHoleRadius * 0.25).toFixed(2);

  return (
    <div className="p-4 space-y-6">
      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Sun className="mr-2 h-6 w-6 text-sidebar-primary" weight="fill" /> Black Hole</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="blackHoleRadius" className="flex items-center text-sm font-medium mb-2">
              <Sun className="mr-2 h-4 w-4" weight="fill" /> Event Horizon Radius: {blackHoleRadius.toFixed(2)}
            </Label>
            <Slider
              id="blackHoleRadius"
              min={0.1}
              max={5}
              step={0.05}
              value={[blackHoleRadius]}
              onValueChange={(value) => setBlackHoleRadius(value[0])}
              aria-label="Event Horizon Radius"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Stack className="mr-2 h-6 w-6 text-sidebar-primary" weight="fill" /> Accretion Disk</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="accretionDiskInnerRadius" className="flex items-center text-sm font-medium mb-2">
              <ArrowLineLeft className="mr-2 h-4 w-4" weight="fill" /> Inner Radius: {accretionDiskInnerRadius.toFixed(2)}
            </Label>
            <Slider
              id="accretionDiskInnerRadius"
              min={0}
              max={10}
              step={0.1}
              value={[accretionDiskInnerRadius]}
              onValueChange={(value) => setAccretionDiskInnerRadius(value[0])}
              aria-label="Accretion Disk Inner Radius"
            />
          </div>
          <div>
            <Label htmlFor="accretionDiskOuterRadius" className="flex items-center text-sm font-medium mb-2">
              <ArrowLineRight className="mr-2 h-4 w-4" weight="fill" /> Outer Radius: {accretionDiskOuterRadius.toFixed(2)}
            </Label>
            <Slider
              id="accretionDiskOuterRadius"
              min={accretionDiskInnerRadius + 0.2}
              max={20}
              step={0.1}
              value={[accretionDiskOuterRadius]}
              onValueChange={(value) => setAccretionDiskOuterRadius(value[0])}
              aria-label="Accretion Disk Outer Radius"
            />
          </div>
          <div>
            <Label htmlFor="accretionDiskOpacity" className="flex items-center text-sm font-medium mb-2">
              <Stack className="mr-2 h-4 w-4" weight="fill" /> Opacity: {accretionDiskOpacity.toFixed(2)}
            </Label>
            <Slider
              id="accretionDiskOpacity"
              min={0.1}
              max={1}
              step={0.05}
              value={[accretionDiskOpacity]}
              onValueChange={(value) => setAccretionDiskOpacity(value[0])}
              aria-label="Accretion Disk Opacity"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Atom className="mr-2 h-6 w-6 text-sidebar-primary" weight="fill" /> Object & Effects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="objectTypeSelect" className="text-sm font-medium">Object Type to Spawn</Label>
            <Select
              value={selectedObjectType}
              onValueChange={(value) => setSelectedObjectType(value as 'planet' | 'star')}
            >
              <SelectTrigger id="objectTypeSelect" className="w-full">
                <SelectValue placeholder="Select object type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planet">Planet</SelectItem>
                <SelectItem value="star">Star</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={onSpawnObjectClick} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
            <Atom className="mr-2 h-4 w-4" weight="fill" /> Spawn {selectedObjectType.charAt(0).toUpperCase() + selectedObjectType.slice(1)}
          </Button>
           <Button onClick={onManualJetEmissionClick} variant="outline" className="w-full">
            <Lightning className="mr-2 h-4 w-4" weight="fill" /> Trigger Hawking Jet (Panel)
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Shift-click on canvas to spawn at cursor. After absorbing {starAbsorptionJetTriggerCount} stars OR {planetAbsorptionJetTriggerCount} planets, Hawking radiation jets might appear.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Gauge className="mr-2 h-6 w-6 text-sidebar-primary" weight="fill" /> Simulation Speed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="simulationSpeed" className="flex items-center text-sm font-medium mb-2">
              <Gauge className="mr-2 h-4 w-4" weight="fill" /> Speed Factor: {simulationSpeed.toFixed(2)}x
            </Label>
            <Slider
              id="simulationSpeed"
              min={0.1}
              max={5}
              step={0.1}
              value={[simulationSpeed]}
              onValueChange={(value) => setSimulationSpeed(value[0])}
              aria-label="Simulation Speed Factor"
            />
          </div>
        </CardContent>
      </Card>

      <Separator className="my-6 bg-sidebar-border/50" />

      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Database className="mr-2 h-6 w-6 text-sidebar-primary" weight="fill" /> Simulation Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between p-2 rounded-md bg-sidebar-accent/30">
            <span className="flex items-center"><Ruler className="mr-2 h-4 w-4 text-sidebar-primary" weight="fill" /> Schwarzschild Radius:</span>
            <span className="font-mono">{calculatedSchwarzschildRadius} units</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-sidebar-accent/30">
            <span className="flex items-center"><Cube className="mr-2 h-4 w-4 text-sidebar-primary" weight="fill" /> Camera Position:</span>
            <span className="font-mono">
              X: {cameraPosition.x.toFixed(1)}, Y: {cameraPosition.y.toFixed(1)}, Z: {cameraPosition.z.toFixed(1)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ControlPanel;

