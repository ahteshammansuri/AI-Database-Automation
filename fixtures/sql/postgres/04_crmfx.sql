CREATE DATABASE crmfx;
\connect crmfx
\i /docker-entrypoint-initdb.d/body/crmfx.sql
