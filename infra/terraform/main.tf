terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state is only acceptable for the validate/plan dry run this was written for —
  # see README.md. Replace with an S3 + DynamoDB backend before ever applying for real.
  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "checkoutkit-${var.environment}"
  common_tags = {
    Project     = "checkoutkit"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
