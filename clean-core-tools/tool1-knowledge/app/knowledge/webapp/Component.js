sap.ui.define(['sap/ui/core/UIComponent'], function (UIComponent) {
  'use strict';
  return UIComponent.extend('knowledge.Component', {
    metadata: { manifest: 'json' },
    init: function () {
      // Apply persisted language BEFORE base init so the ResourceModel and
      // all bindings pick up the correct locale on first render.
      try {
        var saved = window.localStorage.getItem('cc_lang');
        if (saved) {
          sap.ui.getCore().getConfiguration().setLanguage(saved === 'en' ? 'en' : 'zh');
        }
      } catch (e) { /* localStorage unavailable — fall back to default */ }
      UIComponent.prototype.init.apply(this, arguments);
    }
  });
});
