package org.firstinspires.ftc.robotcore.external.navigation;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public class Position {
    public DistanceUnit unit;
    public double x, y, z;
    public long acquisitionTime;
    public Position() { this(DistanceUnit.MM, 0, 0, 0, 0); }
    public Position(DistanceUnit unit, double x, double y, double z, long acquisitionTime) { this.unit = unit; this.x = x; this.y = y; this.z = z; this.acquisitionTime = acquisitionTime; }
}
