output "alb_dns_name" {
  value       = aws_lb.api.dns_name
  description = "Point a real domain's CNAME here once one exists."
}

output "db_endpoint" {
  value     = aws_db_instance.main.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "kafka_bootstrap_brokers" {
  value = aws_msk_cluster.main.bootstrap_brokers_tls
}
