(function () {
    "use strict";

    var audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                return null;
            }
        }
        return audioCtx;
    }

    function playTone(frequency, type, startTime, duration, volume) {
        var ctx = getAudioContext();
        if (!ctx) return;

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = type || "sine";
        osc.frequency.value = frequency;
        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(volume || 0.35, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.start(startTime);
        osc.stop(startTime + duration);
    }

    /**
     * 저장 성공: 밝은 2음 "딩동"
     */
    function playSuccess() {
        var ctx = getAudioContext();
        if (!ctx) return;

        var now = ctx.currentTime;
        playTone(784, "sine", now, 0.25, 0.35);          // G5
        playTone(1047, "sine", now + 0.15, 0.35, 0.30);   // C6
    }

    /**
     * 저장 실패: 낮은 버저 "땡"
     */
    function playError() {
        var ctx = getAudioContext();
        if (!ctx) return;

        var now = ctx.currentTime;
        playTone(220, "square", now, 0.45, 0.25);         // A3 square wave
        playTone(185, "sawtooth", now + 0.05, 0.40, 0.15); // F#3 layer
    }

    window.snSound = {
        playSuccess: playSuccess,
        playError: playError
    };
}());
