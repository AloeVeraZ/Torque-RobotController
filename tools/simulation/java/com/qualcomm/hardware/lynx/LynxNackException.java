package com.qualcomm.hardware.lynx;

import com.qualcomm.hardware.lynx.commands.standard.LynxNack;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxNackException extends Exception {
    private final transient LynxNack nack = new LynxNack();
    public LynxNack getNack() { return nack; }
}
