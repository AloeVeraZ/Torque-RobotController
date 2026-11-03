package org.firstinspires.ftc.vision.apriltag;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import org.firstinspires.ftc.robotcore.external.matrices.VectorF;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;

public class AprilTagClusterMetadata {
    public final String name;
    public final String shortName;
    public final DistanceUnit distanceUnit;
    public final VectorF fieldPosition;
    public final Quaternion fieldOrientation;
    AprilTagClusterMetadata(String name, String shortName, DistanceUnit distanceUnit, VectorF fieldPosition, Quaternion fieldOrientation) { this.name = name; this.shortName = shortName; this.distanceUnit = distanceUnit; this.fieldPosition = fieldPosition; this.fieldOrientation = fieldOrientation; }
}
