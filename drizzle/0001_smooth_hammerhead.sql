CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`investigationId` int,
	`type` enum('sanctions_hit','pep_detected','risk_threshold','velocity','adverse_media','field_report','system') NOT NULL,
	`severity` enum('info','low','medium','high','critical') NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`subjectRef` varchar(64),
	`sourceService` varchar(64),
	`read` boolean NOT NULL DEFAULT false,
	`acknowledged` boolean NOT NULL DEFAULT false,
	`acknowledgedBy` int,
	`acknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userEmail` varchar(320),
	`category` enum('investigation','kyc','alert','report','user','system','api') NOT NULL,
	`action` varchar(255) NOT NULL,
	`targetRef` varchar(64),
	`result` enum('success','warning','failure') NOT NULL DEFAULT 'success',
	`ipAddress` varchar(45),
	`detail` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `field_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskRef` varchar(32) NOT NULL,
	`investigationId` int,
	`agentId` varchar(64) NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`taskType` enum('address_verification','biometric_capture','document_collection','surveillance','interview') NOT NULL,
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`status` enum('pending','dispatched','in_progress','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`subjectName` varchar(255),
	`address` text,
	`state` varchar(64),
	`lga` varchar(64),
	`gpsLat` float,
	`gpsLng` float,
	`deadline` timestamp,
	`instructions` text,
	`result` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `field_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `field_tasks_taskRef_unique` UNIQUE(`taskRef`)
);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ref` varchar(32) NOT NULL,
	`subjectType` enum('individual','corporate') NOT NULL,
	`subjectName` varchar(255) NOT NULL,
	`country` varchar(3) NOT NULL DEFAULT 'NG',
	`tier` enum('basic','standard','comprehensive') NOT NULL DEFAULT 'standard',
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`status` enum('draft','pending','processing','completed','flagged','archived') NOT NULL DEFAULT 'pending',
	`riskScore` float,
	`riskTier` enum('low','medium','high','critical'),
	`nin` varchar(11),
	`bvn` varchar(11),
	`rcNumber` varchar(20),
	`phone` varchar(20),
	`email` varchar(320),
	`address` text,
	`purpose` text,
	`assignedTo` int,
	`createdBy` int NOT NULL,
	`dataSources` json,
	`gatewayResults` json,
	`riskFactors` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `investigations_id` PRIMARY KEY(`id`),
	CONSTRAINT `investigations_ref_unique` UNIQUE(`ref`)
);
--> statement-breakpoint
CREATE TABLE `kyc_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`investigationId` int,
	`subjectName` varchar(255) NOT NULL,
	`nin` varchar(11),
	`bvn` varchar(11),
	`dob` varchar(10),
	`phone` varchar(20),
	`status` enum('pending','processing','passed','failed','review') NOT NULL DEFAULT 'pending',
	`riskScore` float,
	`ninResult` json,
	`bvnResult` json,
	`sanctionsResult` json,
	`pepResult` json,
	`creditResult` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kyc_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportRef` varchar(32) NOT NULL,
	`investigationId` int,
	`template` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`format` enum('pdf','docx','csv','json') NOT NULL DEFAULT 'pdf',
	`status` enum('generating','ready','failed') NOT NULL DEFAULT 'generating',
	`fileUrl` text,
	`sections` json,
	`generatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `reports_reportRef_unique` UNIQUE(`reportRef`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','analyst','supervisor') NOT NULL DEFAULT 'analyst';