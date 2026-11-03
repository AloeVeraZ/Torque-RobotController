package org.firstinspires.ftc.vision.apriltag;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose3D;

public class AprilTagClusterDetection extends AprilTagDetection {
    public final int percentClusterFound;
    public final AprilTagClusterMetadata metadata;
    public AprilTagClusterDetection(int percentClusterFound, AprilTagClusterMetadata metadata, DistanceUnit distanceUnit, AprilTagPoseFtc ftcPose, AprilTagPoseRaw rawPose, Pose3D robotPose, long frameAcquisitionNanoTime) {
        super(ftcPose, rawPose, robotPose, frameAcquisitionNanoTime, distanceUnit);
        this.percentClusterFound = percentClusterFound; this.metadata = metadata;
    }
}
