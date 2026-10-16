CREATE DATABASE IF NOT EXISTS crmfx CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE crmfx;
SOURCE /docker-entrypoint-initdb.d/body/crmfx.sql;
