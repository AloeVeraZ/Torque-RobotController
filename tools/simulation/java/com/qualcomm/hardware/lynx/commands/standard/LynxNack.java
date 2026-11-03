package com.qualcomm.hardware.lynx.commands.standard;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxNack {
    public enum StandardReasonCode { I2C_MASTER_BUSY, I2C_OPERATION_IN_PROGRESS, I2C_NO_RESULTS_PENDING }
    public StandardReasonCode getNackReasonCodeAsEnum() { return StandardReasonCode.I2C_NO_RESULTS_PENDING; }
}
