package org.firstinspires.ftc.teamcode.pedro;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.revhub.localizers.PinpointLocalizer;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/**
 * STARTING VALUES for Pedro Pathing 3.0.2, estimated by Deck Driver Station from the robot set up in its
 * simulator (mecanum, goBILDA Pinpoint). They are not measurements of your robot.
 * Before driving fast: run Deck's guided check (it finds the motor directions and where the odometry sits)
 * and export again, then run the Pedro Quickstart tuners and replace the Foresight numbers with what they measure.
 * To use it: in pedro/Constants.java, return DeckStarterConstants.create(h);
 */
public class DeckStarterConstants {
    /** Drive motors as configured in Deck. Left motors are reversed for a standard mecanum chassis. */
    public static MecanumConfig drivetrain() {
        return new MecanumConfig(c -> {
            c.frontLeftName.set("front_left");
            c.frontRightName.set("front_right");
            c.backLeftName.set("back_left");
            c.backRightName.set("back_right");
            c.frontLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
            c.backLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.backRightDirection.set(DcMotorSimple.Direction.FORWARD);
        });
    }

    /** goBILDA Pinpoint "pinpoint": its pods as set up in Deck (the guided check TeleOp measures them). */
    public static PinpointConfig localizer() {
        return new PinpointConfig(c -> {
            c.name.set("pinpoint");
            c.offsetUnits.set(DistanceUnit.INCH);
            c.xPodOffset.set(4.0);
            c.yPodOffset.set(-3.0);
            c.podType.set(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
            c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
            c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
        });
    }

    /** Foresight from the simulated robot: speeds in in/s, decelerations in in/s², gains in power per inch or radian. */
    public static ForesightConfig foresight() {
        return new ForesightConfig(c -> {
            c.forwardTranslational.set(Controller.piecewise(Controller.proportional(0.109)).put(2.5, Controller.proportional(0.327)));
            c.strafeTranslational.set(Controller.piecewise(Controller.proportional(0.109)).put(2.5, Controller.proportional(0.327)));
            c.coast.set(Controller.proportionalFeedforward(0.01242));
            c.brake.set(Controller.proportionalFeedforward(0.01056));
            c.headingFeedback.set(Controller.proportional(4.391));
            c.headingBrakeCoefficients.set(Vector2D.cartesian(0.05949, 0.004935));
            c.linearBrakeCoefficients.set(Matrix.diag(0.09176, 0.04439));
            c.quadraticBrakeCoefficients.set(Matrix.diag(0.001798, 0.002310));
            c.maxAchievableForwardVelocity.set(80.51);
            c.maxAchievableStrafeVelocity.set(64.408);
            c.naturalForwardDeceleration.set(83.777);
            c.naturalStrafeDeceleration.set(68.95);
        });
    }

    public static Follower create(HardwareMap h) {
        return new Follower(new PinpointLocalizer(h, localizer()), new Mecanum(h, drivetrain()), new Foresight(foresight()));
    }
}
