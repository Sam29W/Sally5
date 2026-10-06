variable "aws_region" {
  type    = string
  default = "ap-south-1" # Mumbai — closest region to this app's India-first user base.
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro" # Cheap default — size from real load before production use.
}

variable "db_multi_az" {
  type    = bool
  default = false # Flip to true for a production environment.
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "api_container_image" {
  type        = string
  description = "Full image URI (e.g. <account>.dkr.ecr.<region>.amazonaws.com/checkoutkit-api:<tag>) — no CI/CD pipeline exists yet to build and push this; see README.md."
}

variable "api_desired_count" {
  type    = number
  default = 2
}
