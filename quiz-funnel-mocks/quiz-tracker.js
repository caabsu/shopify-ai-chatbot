/**
 * Quiz Funnel Analytics Tracker
 * Embed this script in quiz HTML mocks to track sessions and events.
 *
 * Usage:
 *   <script src="quiz-tracker.js"></script>
 *   <script>
 *     QuizTracker.init({ concept: 'reveal' }); // or 'style-profile'
 *   </script>
 *
 * Then call:
 *   QuizTracker.stepEnter('screen-step1');
 *   QuizTracker.stepComplete('screen-step1', { answer: 'ambient' });
 *   QuizTracker.answer('track', 'ambient');
 *   QuizTracker.profileResult('ambient-warm-subtle', 'The Warm Minimalist');
 *   QuizTracker.photoUpload();
 *   QuizTracker.emailCapture('user@example.com');
 *   QuizTracker.productClick('product-handle');
 *   QuizTracker.cartAdd('product-handle');
 */
(function () {
  'use strict';

  var API_BASE = 'https://shopify-ai-chatbot-production-9ab4.up.railway.app';
  var BRAND_ID = '883e4a28-9f2e-4850-a527-29f297d8b6f8';

  var sessionId = null;
  var concept = null;
  var stepTimers = {};
  var initialized = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function generateId() {
    return 'qz_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getStoredSessionId() {
    try {
      var stored = sessionStorage.getItem('quiz_session_id');
      if (stored) return stored;
    } catch (e) {}
    return null;
  }

  function storeSessionId(id) {
    try { sessionStorage.setItem('quiz_session_id', id); } catch (e) {}
  }

  function getDeviceType() {
    var w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function getUtmParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || undefined,
      utm_medium: params.get('utm_medium') || undefined,
      utm_campaign: params.get('utm_campaign') || undefined,
    };
  }

  function post(endpoint, data) {
    try {
      var url = API_BASE + endpoint;
      if (navigator.sendBeacon && typeof Blob !== 'undefined') {
        var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(data));
      }
    } catch (e) {
      console.warn('[QuizTracker] Failed to send:', e);
    }
  }

  function trackEvent(eventType, step, data, durationMs) {
    if (!sessionId) return;
    post('/api/quiz/events', {
      session_id: sessionId,
      event_type: eventType,
      step: step || undefined,
      data: data || undefined,
      duration_ms: durationMs || undefined,
    });
  }

  function updateSession(updates) {
    if (!sessionId) return;
    var xhr = new XMLHttpRequest();
    xhr.open('PATCH', API_BASE + '/api/quiz/sessions/' + sessionId, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(updates));
  }

  // ── Public API ──────────────────────────────────────────────────────────

  var QuizTracker = {
    init: function (options) {
      if (initialized) return;
      initialized = true;

      concept = options.concept || 'reveal';

      // Check for existing session
      var existing = getStoredSessionId();
      if (existing) {
        sessionId = existing;
        trackEvent('page_revisit');
        return;
      }

      // Create new session
      sessionId = generateId();
      storeSessionId(sessionId);

      var utm = getUtmParams();
      post('/api/quiz/sessions', {
        session_id: sessionId,
        concept: concept,
        device_type: getDeviceType(),
        referrer: document.referrer || undefined,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
      });

      trackEvent('funnel_start');

      // Track abandonment on page unload
      window.addEventListener('beforeunload', function () {
        var activeStep = null;
        for (var s in stepTimers) {
          if (stepTimers[s]) activeStep = s;
        }
        if (activeStep) {
          var duration = Date.now() - stepTimers[activeStep];
          trackEvent('step_abandon', activeStep, null, duration);
        }
      });
    },

    stepEnter: function (step) {
      stepTimers[step] = Date.now();
      trackEvent('step_enter', step);
      updateSession({ current_step: step, status: 'in_progress' });
    },

    stepComplete: function (step, data) {
      var duration = stepTimers[step] ? Date.now() - stepTimers[step] : null;
      delete stepTimers[step];
      trackEvent('step_complete', step, data, duration);
    },

    answer: function (questionKey, value) {
      trackEvent('answer_select', null, { question: questionKey, value: value });
    },

    profileResult: function (profileKey, profileName) {
      trackEvent('profile_result', null, { profile_key: profileKey, profile_name: profileName });
      updateSession({ profile_key: profileKey, profile_name: profileName });
    },

    photoUpload: function () {
      trackEvent('photo_upload');
      updateSession({ photo_uploaded: true });
    },

    emailCapture: function (email) {
      trackEvent('email_capture', null, { email: email });
      updateSession({ email: email });
    },

    productClick: function (handle) {
      trackEvent('product_click', null, { handle: handle });
    },

    cartAdd: function (handle) {
      trackEvent('cart_add', null, { handle: handle });
      updateSession({ cart_created: true });
    },

    complete: function () {
      trackEvent('funnel_complete');
      updateSession({ status: 'completed', completed_at: new Date().toISOString() });
    },

    getSessionId: function () {
      return sessionId;
    },
  };

  // Expose globally
  window.QuizTracker = QuizTracker;
})();
