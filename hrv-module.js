// hrv-module.js — rPPG heart rate monitor for breath.html
// Prototype. Not perfect. Exists.
// Usage: const hrv = new HRVModule(); hrv.start(); 
//        hrv.getHRV() → { hr: number, rmssd: number, rrIntervals: number[] }

(function(global) {
  'use strict';

  function HRVModule() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.samples = []; // {t, g}
    this.rrIntervals = []; // ms
    this.lastPeak = null;
    this.running = false;
    this.samplingInterval = null;
  }

  HRVModule.prototype.start = async function() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 320, height: 240, facingMode: 'user' } 
      });
      this.video = document.createElement('video');
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      await this.video.play();

      this.canvas = document.createElement('canvas');
      this.canvas.width = 80;
      this.canvas.height = 80;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      this.running = true;
      this.samples = [];
      this.rrIntervals = [];
      this.lastPeak = null;

      // Sample every 40ms (25 fps)
      this.samplingInterval = setInterval(this._sample.bind(this), 40);
      return true;
    } catch (e) {
      console.warn('HRV: camera access denied or failed', e);
      return false;
    }
  };

  HRVModule.prototype._sample = function() {
    if (!this.running || !this.video.videoWidth) return;

    // Get center region of face (simplified — no face detection)
    // In production: use MediaPipe Face Detection for forehead ROI
    var vw = this.video.videoWidth;
    var vh = this.video.videoHeight;
    var size = Math.min(vw, vh) * 0.25;
    var sx = (vw - size) / 2;
    var sy = (vh - size) / 2 - size * 0.2; // slightly above center = forehead

    this.ctx.drawImage(this.video, sx, sy, size, size, 0, 0, 80, 80);
    var frame = this.ctx.getImageData(0, 0, 80, 80);
    
    // Extract green channel average (hemoglobin absorption)
    var gSum = 0;
    var count = frame.data.length / 4;
    for (var i = 0; i < frame.data.length; i += 4) {
      gSum += frame.data[i + 1]; // G channel
    }
    var gAvg = gSum / count;
    
    this.samples.push({ t: performance.now(), g: gAvg });
    
    // Keep last 10 seconds (250 samples at 25fps)
    if (this.samples.length > 250) {
      this.samples = this.samples.slice(-250);
    }

    // Detect peaks every 40 samples (~1.6s)
    if (this.samples.length >= 50 && this.samples.length % 40 === 0) {
      this._detectPeaks();
    }
  };

  HRVModule.prototype._detectPeaks = function() {
    if (this.samples.length < 50) return;

    // Simple bandpass: moving average subtraction (detrend) + find peaks
    var s = this.samples;
    var n = s.length;
    
    // Detrend: subtract moving average (window=15)
    var detrended = [];
    var window = 15;
    for (var i = 0; i < n; i++) {
      var start = Math.max(0, i - window);
      var end = Math.min(n, i + window);
      var ma = 0;
      for (var j = start; j < end; j++) ma += s[j].g;
      ma /= (end - start);
      detrended.push({ t: s[i].t, v: s[i].g - ma });
    }

    // Find zero-crossings (upward) as simple peak detection
    // In production: use proper bandpass filter 0.7-3.5 Hz + peak detection
    for (var i = 1; i < detrended.length; i++) {
      if (detrended[i].v > 0 && detrended[i-1].v <= 0) {
        // Check if this is a "real" peak (amplitude threshold)
        var maxV = 0;
        for (var k = i; k < Math.min(detrended.length, i + 10); k++) {
          if (detrended[k].v > maxV) maxV = detrended[k].v;
        }
        if (maxV > 0.3) { // threshold — will need tuning
          var peakTime = s[i].t;
          if (this.lastPeak !== null) {
            var rr = peakTime - this.lastPeak;
            // Plausible RR: 300ms (200bpm) to 2000ms (30bpm)
            if (rr > 300 && rr < 2000) {
              this.rrIntervals.push(rr);
              if (this.rrIntervals.length > 100) {
                this.rrIntervals = this.rrIntervals.slice(-100);
              }
            }
          }
          this.lastPeak = peakTime;
        }
      }
    }
  };

  HRVModule.prototype.getHRV = function() {
    if (this.rrIntervals.length < 2) {
      return { hr: 0, rmssd: 0, sdnn: 0, rrIntervals: [], ready: false };
    }

    var rr = this.rrIntervals;
    var n = rr.length;

    // Heart rate (bpm) from average RR
    var avgRR = rr.reduce(function(a, b) { return a + b; }, 0) / n;
    var hr = Math.round(60000 / avgRR);

    // RMSSD (root mean square of successive differences)
    var sumSqDiff = 0;
    for (var i = 1; i < n; i++) {
      var diff = rr[i] - rr[i-1];
      sumSqDiff += diff * diff;
    }
    var rmssd = Math.sqrt(sumSqDiff / (n - 1));

    // SDNN (standard deviation of RR intervals)
    var mean = avgRR;
    var sumSqDev = 0;
    for (var i = 0; i < n; i++) {
      var dev = rr[i] - mean;
      sumSqDev += dev * dev;
    }
    var sdnn = Math.sqrt(sumSqDev / n);

    return {
      hr: hr,
      rmssd: Math.round(rmssd * 10) / 10,
      sdnn: Math.round(sdnn * 10) / 10,
      rrIntervals: rr.slice(),
      ready: n >= 5 // need at least 5 RR intervals for meaningful HRV
    };
  };

  HRVModule.prototype.stop = function() {
    this.running = false;
    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(function(t) { t.stop(); });
      this.stream = null;
    }
  };

  // Export summary for "寄給 Molty"
  HRVModule.prototype.getSummary = function() {
    var hrv = this.getHRV();
    if (!hrv.ready) return null;
    return {
      hr: hrv.hr,
      rmssd: hrv.rmssd,
      sdnn: hrv.sdnn,
      rrCount: hrv.rrIntervals.length
    };
  };

  global.HRVModule = HRVModule;
})(window);
