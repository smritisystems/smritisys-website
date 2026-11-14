-- Register PrathamOne EduOS in the shared product catalog with its canonical edition.

INSERT OR IGNORE INTO products (name, slug, description, price, billing_period, status)
VALUES (
  'PrathamOne EduOS',
  'prathamone-eduos',
  'PrathamOne EduOS Coaching Institute Edition',
  0,
  'subscription',
  'active'
);

INSERT OR IGNORE INTO product_editions (product_id, code, name, description)
SELECT id, 'coaching-institute', 'Coaching Institute Edition',
       'PrathamOne EduOS edition for coaching institutes'
FROM products
WHERE slug = 'prathamone-eduos';

INSERT OR IGNORE INTO product_edition_license_policies
  (edition_id, subscription_grace_days, rollout_stage, evaluation_policy_json)
SELECT id, 7, 'shadow',
       '{"allow_dashboard":true,"allow_read_only_records":true,"allow_reports":true,"allow_backups":true,"allow_exports":true,"locked_modules":["payroll","premium_analytics"]}'
FROM product_editions
WHERE product_id = (SELECT id FROM products WHERE slug = 'prathamone-eduos')
  AND code = 'coaching-institute';
