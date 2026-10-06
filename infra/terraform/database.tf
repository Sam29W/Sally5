resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.common_tags
}

resource "aws_security_group" "db" {
  name   = "${local.name_prefix}-db-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.common_tags
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  db_name  = "checkoutkit"
  username = "checkoutkit"
  # Password is never set here — pulled from Secrets Manager (see secrets.tf) by
  # whoever actually applies this, never committed to state or this file.
  manage_master_user_password = true

  multi_az               = var.db_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period = 7
  backup_window            = "03:00-04:00" # IST overnight, low-traffic window.
  deletion_protection      = var.environment == "production"
  skip_final_snapshot      = var.environment != "production"

  tags = local.common_tags
}
