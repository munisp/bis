ui = false
api_addr = "https://vault:8200"
cluster_addr = "https://vault:8201"
disable_mlock = false

storage "raft" {
  path    = "/vault/data"
  node_id = "bis-onprem-vault-1"
}

listener "tcp" {
  address                             = "0.0.0.0:8200"
  cluster_address                     = "0.0.0.0:8201"
  tls_cert_file                       = "/vault/tls/server.crt"
  tls_key_file                        = "/vault/tls/server.key"
  tls_client_ca_file                  = "/vault/tls/ca.crt"
  tls_require_and_verify_client_cert  = "true"
}

# This template intentionally declares no seal stanza. The operator must choose
# either an HSM/transit auto-unseal configuration or a documented Shamir-unseal
# ceremony before starting Vault. Vault development mode is prohibited.
