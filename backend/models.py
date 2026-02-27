from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Profile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    gender = db.Column(db.String(20))
    dob = db.Column(db.String(20))   # store as string (DD/MM/YYYY)
    height = db.Column(db.Integer)
    weight = db.Column(db.Integer)

    def __repr__(self):
        return f"<Profile {self.name}>"