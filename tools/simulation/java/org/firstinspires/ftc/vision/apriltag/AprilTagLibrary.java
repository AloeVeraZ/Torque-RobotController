package org.firstinspires.ftc.vision.apriltag;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public class AprilTagLibrary {
    private final AprilTagMetadata[] data;
    private AprilTagLibrary(AprilTagMetadata[] data) { this.data = data; }
    public AprilTagMetadata[] getAllTags() { return data; }
    public AprilTagMetadata lookupTag(int id) { for (AprilTagMetadata tag : data) if (tag.id == id) return tag; return null; }
}
