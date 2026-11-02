package org.firstinspires.ftc.robotcore.external.navigation;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public class Pose3D {
    protected final Position position;
    protected final YawPitchRollAngles orientation;
    public Pose3D(Position position, YawPitchRollAngles orientation) { this.position = position; this.orientation = orientation; }
    public Position getPosition() { return position; }
    public YawPitchRollAngles getOrientation() { return orientation; }
}
