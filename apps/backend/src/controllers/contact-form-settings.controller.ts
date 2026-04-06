import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import * as contactFormSettingsService from '../services/contact-form-settings.service.js';

export const contactFormSettingsRouter = Router();

// ── GET /widget/config — Public, returns widget_design + form_config ────

contactFormSettingsRouter.get('/widget/config', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await contactFormSettingsService.getContactFormSettings(brandId);

    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.json({
      widget_design: settings.widget_design,
      form_config: settings.form_config,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[contact-form-settings] GET /widget/config error:', message);
    res.status(500).json({ error: 'Failed to get contact form widget config' });
  }
});

// ── GET /admin/design — Returns widget_design + form_config ─────────────

contactFormSettingsRouter.get('/admin/design', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await contactFormSettingsService.getContactFormSettings(brandId);

    res.json({
      widget_design: settings.widget_design,
      form_config: settings.form_config,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[contact-form-settings] GET /admin/design error:', message);
    res.status(500).json({ error: 'Failed to get contact form design' });
  }
});

// ── PUT /admin/design — Updates widget_design and/or form_config ────────

contactFormSettingsRouter.put('/admin/design', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { widget_design, form_config } = req.body;

    const updates: Record<string, unknown> = {};
    if (widget_design !== undefined) updates.widget_design = widget_design;
    if (form_config !== undefined) updates.form_config = form_config;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No updates provided. Send widget_design and/or form_config.' });
      return;
    }

    const settings = await contactFormSettingsService.updateContactFormSettings(brandId, updates);

    res.json({
      widget_design: settings.widget_design,
      form_config: settings.form_config,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[contact-form-settings] PUT /admin/design error:', message);
    res.status(500).json({ error: 'Failed to update contact form design' });
  }
});
