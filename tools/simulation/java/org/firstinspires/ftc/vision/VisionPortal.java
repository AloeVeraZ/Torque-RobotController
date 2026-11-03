package org.firstinspires.ftc.vision;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
import android.util.Size;

import org.firstinspires.ftc.robotcore.external.hardware.camera.BuiltinCameraDirection;
import org.firstinspires.ftc.robotcore.external.hardware.camera.CameraName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.CameraControl;

public abstract class VisionPortal {
    public enum StreamFormat { YUY2, MJPEG }
    public enum MultiPortalLayout { VERTICAL, HORIZONTAL }
    public enum CameraState { OPENING_CAMERA_DEVICE, CAMERA_DEVICE_READY, STARTING_STREAM, STREAMING, STOPPING_STREAM, CLOSING_CAMERA_DEVICE, CAMERA_DEVICE_CLOSED, ERROR }
    public static VisionPortal easyCreateWithDefaults(CameraName cameraName, VisionProcessor... processors) { return new Builder().setCamera(cameraName).addProcessors(processors).build(); }
    public static VisionPortal easyCreateWithDefaults(BuiltinCameraDirection cameraDirection, VisionProcessor... processors) { return new Builder().setCamera(cameraDirection).addProcessors(processors).build(); }
    public static class Builder {
        public Builder setCamera(CameraName camera) { return this; }
        public Builder setCamera(BuiltinCameraDirection cameraDirection) { return this; }
        public Builder setStreamFormat(StreamFormat streamFormat) { return this; }
        public Builder enableLiveView(boolean enableLiveView) { return this; }
        public Builder setAutoStopLiveView(boolean autoPause) { return this; }
        public Builder setLiveViewContainerId(int liveViewContainerId) { return this; }
        public Builder setCameraResolution(Size cameraResolution) { return this; }
        public Builder addProcessor(VisionProcessor processor) { return this; }
        public Builder addProcessors(VisionProcessor... processors) { return this; }
        public Builder setAutoStartStreamOnBuild(boolean autoStartStreamOnBuild) { return this; }
        public Builder setShowStatsOverlay(boolean showStatsOverlay) { return this; }
        public VisionPortal build() {
            return new VisionPortal() {
                @Override public void setProcessorEnabled(VisionProcessor processor, boolean enabled) { }
                @Override public boolean getProcessorEnabled(VisionProcessor processor) { return false; }
                @Override public CameraState getCameraState() { return CameraState.CAMERA_DEVICE_CLOSED; }
                @Override public void saveNextFrameRaw(String filename) { }
                @Override public void stopStreaming() { }
                @Override public void resumeStreaming() { }
                @Override public void stopLiveView() { }
                @Override public void resumeLiveView() { }
                @Override public float getFps() { return 0; }
                @Override public <T extends CameraControl> T getCameraControl(Class<T> controlType) { return null; }
                @Override public void setActiveCamera(WebcamName webcamName) { }
                @Override public WebcamName getActiveCamera() { return null; }
                @Override public void close() { }
            };
        }
    }
    public abstract void setProcessorEnabled(VisionProcessor processor, boolean enabled);
    public abstract boolean getProcessorEnabled(VisionProcessor processor);
    public abstract CameraState getCameraState();
    public abstract void saveNextFrameRaw(String filename);
    public abstract void stopStreaming();
    public abstract void resumeStreaming();
    public abstract void stopLiveView();
    public abstract void resumeLiveView();
    public abstract float getFps();
    public abstract <T extends CameraControl> T getCameraControl(Class<T> controlType);
    public abstract void setActiveCamera(WebcamName webcamName);
    public abstract WebcamName getActiveCamera();
    public abstract void close();
}
