CREATE DATABASE legacyfx;
\connect legacyfx
\i /docker-entrypoint-initdb.d/body/legacyfx.sql
