package org.firstinspires.ftc.vision.apriltag;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose3D;

/** As FTC SDK 12.0 has it: abstract, with only what a single tag and a cluster share. id, decisionMargin and metadata are on the subclasses. */
public abstract class AprilTagDetection {
    public final AprilTagPoseFtc ftcPose;
    public final AprilTagPoseRaw rawPose;
    public final Pose3D robotPose;
    public final long frameAcquisitionNanoTime;
    public final DistanceUnit distanceUnit;
    public AprilTagDetection(AprilTagPoseFtc ftcPose, AprilTagPoseRaw rawPose, Pose3D robotPose, long frameAcquisitionNanoTime, DistanceUnit distanceUnit) {
        this.ftcPose = ftcPose; this.rawPose = rawPose; this.robotPose = robotPose; this.frameAcquisitionNanoTime = frameAcquisitionNanoTime; this.distanceUnit = distanceUnit;
    }
}
