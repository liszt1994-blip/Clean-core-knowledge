sap.ui.define(['sap/ui/core/UIComponent'], function (UIComponent) {
  'use strict';
  return UIComponent.extend('knowledge.Component', {
    metadata: { manifest: 'json' },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
    }
  });
});
