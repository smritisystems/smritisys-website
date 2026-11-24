UPDATE product_edition_license_policies
SET rollout_stage = 'enforced',
    updated_at = datetime('now')
WHERE rollout_stage = 'shadow'
  AND edition_id IN (
    SELECT edition.id
    FROM product_editions AS edition
    JOIN products AS product ON product.id = edition.product_id
    WHERE product.slug = 'prathamone-eduos'
  );
