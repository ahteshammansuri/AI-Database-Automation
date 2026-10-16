CREATE DATABASE IF NOT EXISTS legacyfx CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE legacyfx;
SOURCE /docker-entrypoint-initdb.d/body/legacyfx.sql;
