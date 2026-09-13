# Apply as the policy bound only to the KES AppRole.
# The mounted K/V v2 engine must be named `kv`; change this policy and kes.yaml together
# if an operator selects another engine mount.
path "kv/data/bis/staging/kes/*" {
  capabilities = ["create", "read", "update"]
}

path "kv/metadata/bis/staging/kes/*" {
  capabilities = ["list", "delete"]
}
