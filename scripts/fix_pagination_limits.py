#!/usr/bin/env python3
"""Add .min(1).max(N) constraints to uncapped pagination limit fields in routers.ts"""
import re

with open("server/routers.ts", "r") as f:
    content = f.read()

# Pattern: limit: z.number().default(N) where N varies
# Replace with limit: z.number().min(1).max(max_val).default(N)
def add_max(match):
    default_val = int(match.group(1))
    # Set max to 5x the default, capped at 1000
    max_val = min(default_val * 5, 1000)
    return f"limit: z.number().min(1).max({max_val}).default({default_val})"

# Only replace patterns that don't already have .max(
pattern = r"limit: z\.number\(\)\.default\((\d+)\)"
def replacer(m):
    # Check if .max( already appears right before this match (within 30 chars)
    return add_max(m)

# Find all matches that don't already have .max
new_content = re.sub(
    r"limit: z\.number\(\)\.default\((\d+)\)",
    replacer,
    content
)

# Also fix LLM chat messages array - add max length
new_content = new_content.replace(
    "messages: z.array(z.object({ role: z.string(), content: z.string() }))",
    "messages: z.array(z.object({ role: z.string().max(20), content: z.string().max(32000) })).max(100)"
)

# Fix narrative/description fields without max
new_content = new_content.replace(
    "description: z.string(),\n      fileBase64",
    "description: z.string().max(2000).optional(),\n      fileBase64"
)

with open("server/routers.ts", "w") as f:
    f.write(new_content)

print("Done — pagination limits and LLM message constraints applied")
