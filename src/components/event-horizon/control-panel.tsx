
"use client";

import React from 'react';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
// ScrollArea is removed as scrolling is handled by SheetContent's wrapper
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sun, PanelLeftClose, PanelRightClose, Layers, Ruler, Move3d, Database, Atom, Zap, Gauge } from 'lucide-react';

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
}) => {
  const calculatedSchwarzschildRadius = (blackHoleRadius * 0.25).toFixed(2);

  return (
    // Removed ScrollArea component
    <div className="p-4 space-y-6">
      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Sun className="mr-2 h-6 w-6 text-sidebar-primary" /> Black Hole</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="blackHoleRadius" className="flex items-center text-sm font-medium mb-2">
              <Sun className="mr-2 h-4 w-4" /> Event Horizon Radius: {blackHoleRadius.toFixed(2)}
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
          <CardTitle className="text-xl font-headline flex items-center"><Layers className="mr-2 h-6 w-6 text-sidebar-primary" /> Accretion Disk</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="accretionDiskInnerRadius" className="flex items-center text-sm font-medium mb-2">
              <PanelLeftClose className="mr-2 h-4 w-4" /> Inner Radius: {accretionDiskInnerRadius.toFixed(2)}
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
              <PanelRightClose className="mr-2 h-4 w-4" /> Outer Radius: {accretionDiskOuterRadius.toFixed(2)}
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
              <Layers className="mr-2 h-4 w-4" /> Opacity: {accretionDiskOpacity.toFixed(2)}
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
          <CardTitle className="text-xl font-headline flex items-center"><Atom className="mr-2 h-6 w-6 text-sidebar-primary" /> Object & Effects</CardTitle>
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
            <Atom className="mr-2 h-4 w-4" /> Spawn {selectedObjectType.charAt(0).toUpperCase() + selectedObjectType.slice(1)}
          </Button>
           <Button onClick={onManualJetEmissionClick} variant="outline" className="w-full">
            <Zap className="mr-2 h-4 w-4" /> Trigger Hawking Jet (Panel)
          </Button>
          <p className="text-xs text-muted-foreground text-center">Shift-click on canvas to spawn at cursor. After {3} absorptions, Hawking radiation jets might appear briefly.</p>
        </CardContent>
      </Card>

      <Card className="bg-sidebar/70 text-sidebar-foreground border-sidebar-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center"><Gauge className="mr-2 h-6 w-6 text-sidebar-primary" /> Simulation Speed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="simulationSpeed" className="flex items-center text-sm font-medium mb-2">
              <Gauge className="mr-2 h-4 w-4" /> Speed Factor: {simulationSpeed.toFixed(2)}x
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
          <CardTitle className="text-xl font-headline flex items-center"><Database className="mr-2 h-6 w-6 text-sidebar-primary" /> Simulation Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between p-2 rounded-md bg-sidebar-accent/30">
            <span className="flex items-center"><Ruler className="mr-2 h-4 w-4 text-sidebar-primary" /> Schwarzschild Radius:</span>
            <span className="font-mono">{calculatedSchwarzschildRadius} units</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-sidebar-accent/30">
            <span className="flex items-center"><Move3d className="mr-2 h-4 w-4 text-sidebar-primary" /> Camera Position:</span>
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
