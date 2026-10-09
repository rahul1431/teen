#!/usr/bin/env python3
"""
Oracle Cloud A1.Flex Auto-Retry Script
Runs via GitHub Actions.
Loops for ~3.5 minutes per run (retrying every 15s) to maximize chance of claiming capacity.
Exits immediately if VM already exists or is successfully created.
"""

import oci
import os
import sys
import time
import datetime

# ─── Config from Environment ─────────────────────────────────────────────────
COMPARTMENT_ID  = os.environ["OCI_COMPARTMENT_ID"]
SUBNET_ID       = os.environ.get("OCI_SUBNET_ID")
IMAGE_ID        = os.environ.get("OCI_IMAGE_ID")
SSH_PUBLIC_KEY  = os.environ["OCI_SSH_PUBLIC_KEY"]
REGION          = os.environ.get("OCI_REGION", "ap-singapore-1")

# VM Configuration (Always Free eligible)
SHAPE           = "VM.Standard.A1.Flex"
OCPUS           = 2
MEMORY_GB       = 12
BOOT_VOLUME_GB  = 100
INSTANCE_NAME   = "teen-prod"

# Max duration for this workflow run to loop (seconds)
MAX_RUN_SECONDS = 210  # 3.5 minutes (leaves buffer before 4min timeout)
RETRY_DELAY_SEC = 15   # Delay between retry attempts

def ts():
    return datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

def main():
    print(f"[{ts()}] 🚀 Oracle A1 Auto-Retry Script Starting")
    print(f"[{ts()}] Region: {REGION}")
    print(f"[{ts()}] Target Shape: {SHAPE} ({OCPUS} OCPUs, {MEMORY_GB} GB RAM)")
    print("─" * 65)

    # 1. Initialize OCI clients
    try:
        config = oci.config.from_file("~/.oci/config")
        compute = oci.core.ComputeClient(config)
        identity = oci.identity.IdentityClient(config)
        network = oci.core.VirtualNetworkClient(config)
        print(f"[{ts()}] ✅ OCI authentication and clients initialized successfully")
    except Exception as e:
        print(f"[{ts()}] ❌ Failed to initialize OCI client: {e}")
        sys.exit(1)

    # 2. Check if instance ALREADY exists
    try:
        instances = compute.list_instances(COMPARTMENT_ID).data
        active_instances = [
            i for i in instances 
            if i.display_name == INSTANCE_NAME and i.lifecycle_state in ["PROVISIONING", "RUNNING", "STARTING"]
        ]
        if active_instances:
            inst = active_instances[0]
            print(f"\n[{ts()}] 🎉 ═══════════════════════════════════════════════════")
            print(f"[{ts()}] 🎉 VM '{INSTANCE_NAME}' ALREADY EXISTS AND IS {inst.lifecycle_state}!")
            print(f"[{ts()}] 🎉 Instance ID: {inst.id}")
            print(f"[{ts()}] 🎉 Stopping retry loop.")
            print(f"[{ts()}] 🎉 ═══════════════════════════════════════════════════")
            sys.exit(0)
    except Exception as e:
        print(f"[{ts()}] ⚠️ Could not check existing instances: {e}")

    # 3. Fetch Availability Domains
    try:
        ad_response = identity.list_availability_domains(COMPARTMENT_ID)
        availability_domains = [ad.name for ad in ad_response.data]
        print(f"[{ts()}] 📍 Available Domain(s): {', '.join(availability_domains)}")
    except Exception as e:
        print(f"[{ts()}] ⚠️ Fallback to default AD: {e}")
        availability_domains = ["VoYY:AP-SINGAPORE-1-AD-1"]

    # 4. Resolve Subnet
    global SUBNET_ID
    if not SUBNET_ID:
        try:
            subnets = network.list_subnets(COMPARTMENT_ID).data
            public_subnets = [s for s in subnets if not s.prohibit_public_ip_on_vnic]
            if public_subnets:
                SUBNET_ID = public_subnets[0].id
                print(f"[{ts()}] 🌐 Auto-detected public subnet: {public_subnets[0].display_name}")
            elif subnets:
                SUBNET_ID = subnets[0].id
                print(f"[{ts()}] 🌐 Auto-detected subnet: {subnets[0].display_name}")
        except Exception as e:
            print(f"[{ts()}] ⚠️ Subnet auto-detect error: {e}")

    # 5. Resolve Image
    global IMAGE_ID
    if not IMAGE_ID or IMAGE_ID == "auto":
        try:
            images = compute.list_images(
                COMPARTMENT_ID,
                operating_system="Canonical Ubuntu",
                operating_system_version="22.04",
                shape=SHAPE
            ).data
            if images:
                IMAGE_ID = images[0].id
                print(f"[{ts()}] 💿 Auto-detected OS Image: {images[0].display_name}")
        except Exception as e:
            print(f"[{ts()}] ⚠️ Image auto-detect fallback: {e}")
            IMAGE_ID = "ocid1.image.oc1.ap-singapore-1.aaaaaaaa4rgzowsv4u6hk6ugkk2be7ztbowlxwnonuvsxq4d73yjy4fc22ka"

    # 6. Retry Loop for up to MAX_RUN_SECONDS
    start_time = time.time()
    attempt = 1

    print(f"\n[{ts()}] 🔄 Starting continuous retry loop (up to {MAX_RUN_SECONDS}s, every {RETRY_DELAY_SEC}s)...")

    while (time.time() - start_time) < MAX_RUN_SECONDS:
        elapsed = int(time.time() - start_time)
        print(f"\n[{ts()}] [Attempt #{attempt} | Elapsed {elapsed}s] Requesting VM from Oracle...")

        for ad in availability_domains:
            result, data = attempt_create(compute, ad)

            if result == "SUCCESS":
                print(f"\n[{ts()}] 🎉 ═══════════════════════════════════════════════════")
                print(f"[{ts()}] 🎉  VM CREATED SUCCESSFULLY ON ATTEMPT #{attempt}!")
                print(f"[{ts()}] 🎉  Instance ID: {data.id}")
                print(f"[{ts()}] 🎉  Check Oracle Console → Compute → Instances")
                print(f"[{ts()}] 🎉 ═══════════════════════════════════════════════════")
                sys.exit(0)

            elif result == "CAPACITY_ERROR":
                print(f"[{ts()}]   ⏳ {ad}: Out of host capacity (AD full).")

            else:
                print(f"[{ts()}]   ⚠️ {ad}: {result}")

        attempt += 1
        remaining = int(MAX_RUN_SECONDS - (time.time() - start_time))
        if remaining > RETRY_DELAY_SEC:
            time.sleep(RETRY_DELAY_SEC)
        else:
            break

    print(f"\n[{ts()}] 💤 Run finished {attempt - 1} attempts. Host still busy in Singapore.")
    print(f"[{ts()}] 🔁 Next GitHub Actions cycle will trigger and retry automatically.")
    sys.exit(0)


def attempt_create(compute: oci.core.ComputeClient, availability_domain: str):
    """
    Attempts to launch the VM.Standard.A1.Flex instance.
    """
    try:
        launch_details = oci.core.models.LaunchInstanceDetails(
            availability_domain=availability_domain,
            compartment_id=COMPARTMENT_ID,
            display_name=INSTANCE_NAME,
            shape=SHAPE,
            shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
                ocpus=OCPUS,
                memory_in_gbs=MEMORY_GB
            ),
            source_details=oci.core.models.InstanceSourceViaImageDetails(
                source_type="image",
                image_id=IMAGE_ID,
                boot_volume_size_in_gbs=BOOT_VOLUME_GB
            ),
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=SUBNET_ID,
                assign_public_ip=True,
                display_name="teen-prod-vnic"
            ),
            metadata={
                "ssh_authorized_keys": SSH_PUBLIC_KEY
            }
        )

        response = compute.launch_instance(launch_details)
        return "SUCCESS", response.data

    except oci.exceptions.ServiceError as e:
        if "Out of capacity" in str(e.message) or "InternalError" in str(e.code) or e.status in [500, 429]:
            return "CAPACITY_ERROR", None
        return f"HTTP {e.status} {e.code}: {e.message}", None

    except Exception as e:
        return f"Unexpected error: {str(e)}", None


if __name__ == "__main__":
    main()
