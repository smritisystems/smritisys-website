ALTER TABLE sessions
  ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
