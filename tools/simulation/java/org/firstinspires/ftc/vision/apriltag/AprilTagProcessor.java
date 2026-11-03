package org.firstinspires.ftc.vision.apriltag;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import java.util.ArrayList;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Position;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;
import org.firstinspires.ftc.vision.VisionProcessor;

public abstract class AprilTagProcessor implements VisionProcessor {
    public static final int THREADS_DEFAULT = 3;
    public enum TagFamily { TAG_36h11, TAG_25h9, TAG_16h5, TAG_standard41h12 }
    public enum PoseSolver { APRILTAG_BUILTIN, OPENCV_ITERATIVE, OPENCV_SOLVEPNP_EPNP, OPENCV_IPPE, OPENCV_IPPE_SQUARE, OPENCV_SQPNP }
    public static AprilTagProcessor easyCreateWithDefaults() { return new Builder().build(); }
    public static class Builder {
        public Builder setCameraPose(Position position, YawPitchRollAngles orientation) { return this; }
        public Builder setLensIntrinsics(double fx, double fy, double cx, double cy) { return this; }
        public Builder setSuppressCalibrationWarnings(boolean suppressCalibrationWarnings) { return this; }
        public Builder setTagFamily(TagFamily tagFamily) { return this; }
        public Builder setTagLibrary(AprilTagLibrary tagLibrary) { return this; }
        public Builder setOutputUnits(DistanceUnit distanceUnit, AngleUnit angleUnit) { return this; }
        public Builder setDrawAxes(boolean drawAxes) { return this; }
        public Builder setDrawCubeProjection(boolean drawCube) { return this; }
        public Builder setDrawTagOutline(boolean drawOutline) { return this; }
        public Builder setDrawTagID(boolean drawTagId) { return this; }
        public Builder setNumThreads(int threads) { return this; }
        public AprilTagProcessor build() {
            return new AprilTagProcessor() {
                @Override public void setDecimation(float decimation) { }
                @Override public void setPoseSolver(PoseSolver poseSolver) { }
                @Override public int getPerTagAvgPoseSolveTime() { return 0; }
                @Override public ArrayList<AprilTagDetection> getDetections() { return new ArrayList<>(); }
                @Override public ArrayList<AprilTagDetection> getFreshDetections() { return new ArrayList<>(); }
            };
        }
    }
    public abstract void setDecimation(float decimation);
    public abstract void setPoseSolver(PoseSolver poseSolver);
    public abstract int getPerTagAvgPoseSolveTime();
    public abstract ArrayList<AprilTagDetection> getDetections();
    public abstract ArrayList<AprilTagDetection> getFreshDetections();
}
