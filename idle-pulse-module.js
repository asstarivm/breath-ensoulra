// idle-pulse CSS Injection Module v2
// Injects idle window pulse visualization into breath.html render loop
// v2: adds idleIndicatorNoticed proxy tracking + progressive opacity

(function() {
  // Wait for DOM ready
  if (document.readyState !== 'loading') {
    initIdlePulse();
  } else {
    document.addEventListener('DOMContentLoaded', initIdlePulse);
  }

  function initIdlePulse() {
    // Create idle pulse stylesheet
    var idleStyleSheet = document.createElement('style');
    idleStyleSheet.id = 'idle-pulse-style';
    idleStyleSheet.textContent = 
      '@keyframes idlePulse {' +
        '0%, 100% { opacity: 0.3; transform: scale(1); }' +
        '50% { opacity: 0.7; transform: scale(1.05); }' +
      '} ' +
      '#idle-indicator {' +
        'position: fixed;' +
        'bottom: 20px;' +
        'left: 50%;' +
        'transform: translateX(-50%);' +
        'width: 12px;' +
        'height: 12px;' +
        'border-radius: 50%;' +
        'background: rgba(247, 248, 248, 0.4);' +
        'animation: idlePulse 10s ease-in-out infinite;' +
        'opacity: 0;' +
        'transition: opacity 1.5s ease;' +
        'pointer-events: none;' +
        'z-index: 5;' +
      '}' +
      '#idle-indicator.visible { opacity: 0.3; }' +
      '#idle-indicator.visible-15s { opacity: 0.6; }' +
      '#idle-indicator.visible-30s { opacity: 0.8; transform: translateX(-50%) scale(1.15); }';
    document.head.appendChild(idleStyleSheet);

    // Create idle indicator element
    var indicator = document.createElement('div');
    indicator.id = 'idle-indicator';
    document.body.appendChild(indicator);

    // Track idle state
    var lastInteraction = Date.now();
    var IDLE_THRESHOLD = 5000; // 5 seconds = idle
    var IS_VISIBLE = false;
    var idleStartTs = null; // when idle began

    // P0: idleIndicatorNoticed proxy tracking
    // Expose state for breath.html metrics to read
    window.__idlePulse = {
      isVisible: function() { return IS_VISIBLE; },
      idleStartTs: null,
      idleIndicatorNoticed: false, // set true when user resumes interaction near indicator
      idleIndicatorShownCount: 0  // how many times indicator appeared
    };

    // Progressive opacity thresholds
    var PROGRESSIVE_15S = 15000; // 15s idle → opacity 0.6
    var PROGRESSIVE_30S = 30000; // 30s idle → opacity 0.8 + micro-scale

    // Indicator position (bottom center, 20px from bottom, 12px diameter)
    var INDICATOR_CENTER_X = window.innerWidth / 2;
    var INDICATOR_CENTER_Y = window.innerHeight - 26; // 20px bottom + 6px half-height
    var NEARBY_THRESHOLD = 80; // px — "near indicator" zone

    // Listen for interactions — check if resuming from near indicator
    function handleInteraction(e) {
      var wasVisible = IS_VISIBLE;
      var idleDuration = idleStartTs ? Date.now() - idleStartTs : 0;

      lastInteraction = Date.now();

      if (IS_VISIBLE) {
        // Check if interaction point is near the idle indicator (proxy for "noticed")
        var x, y;
        if (e.touches && e.touches[0]) {
          x = e.touches[0].clientX;
          y = e.touches[0].clientY;
        } else if (e.clientX !== undefined) {
          x = e.clientX;
          y = e.clientY;
        } else {
          // mousemove — check if near indicator area
          x = e.clientX || INDICATOR_CENTER_X;
          y = e.clientY || INDICATOR_CENTER_Y;
        }

        // Only count as "noticed" for actual touches/clicks (not mousemove)
        var isRealInteraction = e.type === 'touchstart' || e.type === 'mousedown';
        if (isRealInteraction) {
          var dx = Math.abs(x - INDICATOR_CENTER_X);
          var dy = Math.abs(y - INDICATOR_CENTER_Y);
          if (dx < NEARBY_THRESHOLD && dy < NEARBY_THRESHOLD) {
            window.__idlePulse.idleIndicatorNoticed = true;
          }
        }

        // Remove all visible classes
        indicator.classList.remove('visible', 'visible-15s', 'visible-30s');
        IS_VISIBLE = false;
        window.__idlePulse.idleStartTs = null;
      }
    }

    ['mousedown', 'touchstart'].forEach(function(evt) {
      document.addEventListener(evt, handleInteraction, { passive: true });
    });

    // mousemove only resets lastInteraction (doesn't count as noticing)
    document.addEventListener('mousemove', function() {
      lastInteraction = Date.now();
      if (IS_VISIBLE) {
        indicator.classList.remove('visible', 'visible-15s', 'visible-30s');
        IS_VISIBLE = false;
        window.__idlePulse.idleStartTs = null;
      }
    }, { passive: true });

    // Render loop integration
    function tick() {
      var elapsed = Date.now() - lastInteraction;
      
      // P1: Breath sync — match indicator animation to current breath speed
      if (IS_VISIBLE) {
        var breathState = window.__breathState || { speed: 1, duration: 10000 };
        var currentDuration = breathState.duration;
        // Only update if duration changed (avoid redundant DOM writes)
        if (currentDuration > 0 && indicator.dataset.lastDuration !== String(currentDuration)) {
          var durationSec = currentDuration / 1000;
          indicator.style.animationDuration = durationSec + 's';
          indicator.dataset.lastDuration = String(currentDuration);
        } else if (currentDuration === 0) {
          // Breath paused — pause indicator too
          if (indicator.style.animationPlayState !== 'paused') {
            indicator.style.animationPlayState = 'paused';
          }
        } else {
          if (indicator.style.animationPlayState === 'paused') {
            indicator.style.animationPlayState = 'running';
          }
        }
      }
      
      if (elapsed > IDLE_THRESHOLD && !IS_VISIBLE) {
        IS_VISIBLE = true;
        idleStartTs = Date.now();
        window.__idlePulse.idleStartTs = idleStartTs;
        window.__idlePulse.idleIndicatorShownCount++;
        indicator.classList.add('visible');
      } else if (IS_VISIBLE) {
        // Progressive opacity
        if (elapsed > PROGRESSIVE_30S) {
          indicator.classList.remove('visible', 'visible-15s');
          if (!indicator.classList.contains('visible-30s')) {
            indicator.classList.add('visible-30s');
          }
        } else if (elapsed > PROGRESSIVE_15S) {
          indicator.classList.remove('visible', 'visible-30s');
          if (!indicator.classList.contains('visible-15s')) {
            indicator.classList.add('visible-15s');
          }
        }
      } else if (elapsed <= IDLE_THRESHOLD && IS_VISIBLE) {
        IS_VISIBLE = false;
        idleStartTs = null;
        window.__idlePulse.idleStartTs = null;
        indicator.classList.remove('visible', 'visible-15s', 'visible-30s');
      }

      requestAnimationFrame(tick);
    }

    // Start render loop
    tick();

    // Log initialization
    console.log('[idle-pulse v2] initialized — idleThreshold=' + IDLE_THRESHOLD + 'ms, progressiveOpacity: 5s/15s/30s, noticedProxy: enabled');
  }
})();