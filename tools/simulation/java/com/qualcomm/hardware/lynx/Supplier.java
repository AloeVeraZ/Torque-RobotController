package com.qualcomm.hardware.lynx;

import com.qualcomm.robotcore.exception.RobotCoreException;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public interface Supplier<T> {
    T get() throws InterruptedException, RobotCoreException, LynxNackException;
}
