# NyxMail talks to this worker for POST /checkv2.
bind_socket = "127.0.0.1:11333";

# Only the local web/worker process needs to submit messages.
allow_file_and_shm_inputs = false;
