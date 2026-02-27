from flask import Flask, request, jsonify
from models import db, Profile

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///db.sqlite3"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

# Create tables
with app.app_context():
    db.create_all()

@app.route("/profile", methods=["POST"])
def save_profile():
    data = request.json
    profile = Profile(
        name=data.get("name"),
        gender=data.get("gender"),
        dob=data.get("dob"),
        height=data.get("height"),
        weight=data.get("weight"),
    )
    db.session.add(profile)
    db.session.commit()
    return jsonify({"status": "success", "message": "Profile saved"})

if __name__ == "__main__":
    # IMPORTANT: bind to 0.0.0.0 so your phone can reach it
    app.run(host="0.0.0.0", port=5000, debug=True)