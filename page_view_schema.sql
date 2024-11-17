DROP TABLE IF EXISTS Page_Views;
CREATE TABLE IF NOT EXISTS Page_Views (pageId INTEGER PRIMARY KEY, post TEXT, totalViews INTEGER, lastUpdated TEXT);
INSERT INTO Page_Views VALUES (1, 'beginnings', 8, '2024-11-16');
INSERT INTO Page_Views VALUES (2, 'adding-view-count-to-blog', 5, '2024-11-16');
INSERT INTO Page_Views VALUES (3, 'introducing-dream-world', 7, '2024-11-16');